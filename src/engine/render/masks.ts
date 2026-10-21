// Roto masks at render time: where a clip's mask paths are on the canvas at a moment (keyframes,
// tracker), and cutting a drawn layer down to them. Shared by preview, export and the canvas editor.
//
// Layer units: source pixels for video and images (top-left of the uncropped picture), otherwise
// project pixels at scale 1 around the clip's position. `layerAffine` maps them to project pixels.
import { numberAt, pathAt } from '../../model/masks';
import type { Clip, MaskMode, MaskVertex, Project, RotoMask, Tracker, Transform } from '../../model/types';
import { isOverlay } from '../../model/overlays';
import { sampleAt, type Pt } from './motion';
import { placeMedia } from './placement';

/** [a, b, c, d, e, f]: (x, y) → (a·x + c·y + e, b·x + d·y + f), as in DOMMatrix. */
export type Affine = [number, number, number, number, number, number];

export const applyAffine = (m: Affine, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] });
export const applyLinear = (m: Affine, p: Pt): Pt => ({ x: m[0] * p.x + m[2] * p.y, y: m[1] * p.x + m[3] * p.y });

export function invertAffine(m: Affine): Affine {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c || 1e-12;
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** m ∘ n: first n, then m. */
export const composeAffine = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[2] * n[1],
  m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3],
  m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4],
  m[1] * n[4] + m[3] * n[5] + m[5],
];

/** Uniform scale of a similarity map. */
export const affineScale = (m: Affine) => Math.hypot(m[0], m[1]);

/** Source size of a video/image clip, when known. */
export function mediaSize(project: Project, clip: Clip) {
  if (isOverlay(clip)) return undefined;
  const a = clip.assetId ? project.assets[clip.assetId] : undefined;
  return a?.width && a.height && a.kind !== 'audio' ? { sw: a.width, sh: a.height } : undefined;
}

/** Layer units → project pixels for a clip drawn with `tr` (undefined: media of unknown size). */
export function layerAffine(project: Project, clip: Clip, tr: Transform = clip.transform): Affine | undefined {
  const { width: W, height: H } = project.settings;
  const rot = (tr.rotation * Math.PI) / 180;
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  if (isOverlay(clip)) {
    const k = tr.scale;
    return [k * cos, k * sin, -k * sin, k * cos, W / 2 + tr.x * W, H / 2 + tr.y * H];
  }
  const size = mediaSize(project, clip);
  if (!size) return undefined;
  const p = placeMedia(size.sw, size.sh, W, H, tr);
  const f = p.frame.w / size.sw;
  const c = Math.cos(p.rotation);
  const s = Math.sin(p.rotation);
  return [f * c, f * s, -f * s, f * c, p.cx + c * p.frame.x - s * p.frame.y, p.cy + s * p.frame.x + c * p.frame.y];
}

const RAD = Math.PI / 180;

/** The tracker a mask follows: on the clip itself, or on another clip of the same media (a copy above it). */
export function maskTracker(project: Project, clip: Clip, trackerId: string): Tracker | undefined {
  const own = clip.trackers?.find((x) => x.id === trackerId);
  if (own || !clip.assetId) return own;
  for (const track of project.tracks)
    for (const c of track.clips) {
      if (c.assetId !== clip.assetId) continue;
      const hit = c.trackers?.find((x) => x.id === trackerId);
      if (hit) return hit;
    }
  return undefined;
}

/**
 * Where a tracker carries a mask at source time s, in layer units: G(X) = anchor + R(da)·k·(X − P_ref),
 * the identity at the reference time. Undefined when the mask is not carried.
 */
export function maskCarry(project: Project, clip: Clip, mask: RotoMask, s: number): Affine | undefined {
  const link = mask.track;
  const size = link && mediaSize(project, clip);
  const tracker = link && size && maskTracker(project, clip, link.trackerId);
  const now = tracker && sampleAt(tracker, s);
  const then = tracker && sampleAt(tracker, link!.ref);
  if (!link || !size || !now || !then) return undefined;
  const da = link.rotation ? (now[3] - then[3]) * RAD : 0;
  const k = link.scale ? now[4] / then[4] : 1;
  const P = { x: then[1] * size.sw, y: then[2] * size.sh };
  const A = link.position ? { x: now[1] * size.sw, y: now[2] * size.sh } : P;
  const a = k * Math.cos(da);
  const b = k * Math.sin(da);
  return [a, b, -b, a, A.x - (a * P.x - b * P.y), A.y - (b * P.x + a * P.y)];
}

/** A mask as it is drawn at one moment, in layer units. */
export interface MaskShape {
  mode: MaskMode;
  inverted: boolean;
  path: MaskVertex[];
  feather: number;
  expansion: number;
  opacity: number;
}

export function mapPath(path: MaskVertex[], m: Affine): MaskVertex[] {
  return path.map((v) => {
    const p = applyAffine(m, { x: v[0], y: v[1] });
    const a = applyLinear(m, { x: v[2], y: v[3] });
    const b = applyLinear(m, { x: v[4], y: v[5] });
    return [p.x, p.y, a.x, a.y, b.x, b.y];
  });
}

/** One mask at source time s (keyframes and tracker applied). */
export function maskShapeAt(project: Project, clip: Clip, mask: RotoMask, s: number): MaskShape {
  const carry = maskCarry(project, clip, mask, s);
  const path = pathAt(mask.path, s);
  const k = carry ? affineScale(carry) : 1;
  return {
    mode: mask.mode,
    inverted: !!mask.inverted,
    path: carry ? mapPath(path, carry) : path,
    feather: Math.max(0, numberAt(mask.feather, s)) * k,
    expansion: numberAt(mask.expansion, s) * k,
    opacity: Math.min(1, Math.max(0, numberAt(mask.opacity, s))),
  };
}

/** Everything needed to cut a clip at time t: its masks and the layer → project-pixel map. */
export interface ResolvedMasks {
  layer: Affine;
  shapes: MaskShape[];
}

/**
 * The clip's masks at timeline time t, for a clip drawn as `drawn` (its transform after motion).
 * Undefined when nothing would be cut.
 */
export function resolveMasks(project: Project, clip: Clip, t: number, drawn: Clip = clip): ResolvedMasks | undefined {
  const live = clip.masks?.filter((m) => !m.off && m.path.value.length >= 3);
  if (!live?.length) return undefined;
  const layer = layerAffine(project, drawn, drawn.transform);
  if (!layer) return undefined;
  const s = clip.inPoint + (t - clip.start) * clip.speed;
  const shapes = live.map((m) => maskShapeAt(project, clip, m, s)).filter((m) => m.opacity > 0);
  return shapes.length ? { layer, shapes } : undefined;
}

// ---- drawing --------------------------------------------------------------------------------------

type Ctx = OffscreenCanvasRenderingContext2D;

export function tracePath(c: Ctx | CanvasRenderingContext2D | Path2D, path: MaskVertex[]) {
  const n = path.length;
  c.moveTo(path[0][0], path[0][1]);
  for (let i = 0; i < n; i++) {
    const a = path[i];
    const b = path[(i + 1) % n];
    if (a[4] || a[5] || b[2] || b[3]) c.bezierCurveTo(a[0] + a[4], a[1] + a[5], b[0] + b[2], b[1] + b[3], b[0], b[1]);
    else c.lineTo(b[0], b[1]);
  }
  c.closePath();
}

const pool: OffscreenCanvas[] = [];
function scratch(i: number, w: number, h: number): Ctx {
  let c = pool[i];
  if (!c) c = pool[i] = new OffscreenCanvas(w, h);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const ctx = c.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.shadowColor = 'transparent';
  ctx.clearRect(0, 0, w, h);
  return ctx;
}

/** One mask's coverage (alpha) on a scratch canvas: filled, grown/shrunk, feathered, inverted. */
function drawShape(m: MaskShape, T: Affine, w: number, h: number): Ctx {
  const c = scratch(1, w, h);
  c.setTransform(...T);
  c.beginPath();
  tracePath(c, m.path);
  c.fillStyle = '#000';
  c.fill();
  if (Math.abs(m.expansion) > 0.01) {
    // A stroke twice the expansion wide, round-joined: grows the shape, or eats into it.
    c.lineJoin = 'round';
    c.lineWidth = 2 * Math.abs(m.expansion);
    c.strokeStyle = '#000';
    if (m.expansion < 0) c.globalCompositeOperation = 'destination-out';
    c.stroke();
    c.globalCompositeOperation = 'source-over';
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  let out = c;
  const feather = m.feather * affineScale(T);
  if (feather > 0.5) {
    // The soft edge is the shadow of the shape drawn out of sight: blurs the same way in every
    // browser and in workers (unlike ctx.filter).
    const soft = scratch(2, w, h);
    const off = w + h + 4 * feather;
    soft.shadowColor = '#000';
    soft.shadowBlur = feather;
    soft.shadowOffsetX = off;
    soft.drawImage(c.canvas, -off, 0);
    soft.shadowColor = 'transparent';
    out = soft;
  }
  if (m.inverted) {
    out.globalCompositeOperation = 'xor';
    out.fillStyle = '#000';
    out.fillRect(0, 0, w, h);
    out.globalCompositeOperation = 'source-over';
  }
  return out;
}

/**
 * Keep only the part of `layer` the masks let through. `view` maps project pixels to the layer's
 * pixels. Masks combine top to bottom (After Effects): a first Subtract or Intersect works on the
 * whole layer.
 */
export function applyMasks(layer: OffscreenCanvas, masks: ResolvedMasks, view: Affine) {
  const { width: w, height: h } = layer;
  const T = composeAffine(view, masks.layer);
  const acc = scratch(0, w, h);
  acc.fillStyle = '#000';
  const first = masks.shapes[0].mode;
  if (first === 'subtract' || first === 'intersect') acc.fillRect(0, 0, w, h);
  for (const m of masks.shapes) {
    const one = drawShape(m, T, w, h);
    const o = m.opacity;
    if (m.mode === 'intersect') {
      // Partial strength: o·m + (1 − o), so 0 % leaves the layer alone.
      if (o < 1) {
        one.globalCompositeOperation = 'destination-in';
        one.globalAlpha = o;
        one.fillRect(0, 0, w, h);
        one.globalCompositeOperation = 'lighter';
        one.globalAlpha = 1 - o;
        one.fillRect(0, 0, w, h);
        one.globalAlpha = 1;
        one.globalCompositeOperation = 'source-over';
      }
      acc.globalCompositeOperation = 'destination-in';
    } else acc.globalCompositeOperation = m.mode === 'add' ? 'lighter' : m.mode === 'subtract' ? 'destination-out' : 'xor';
    acc.globalAlpha = m.mode === 'intersect' ? 1 : o;
    acc.drawImage(one.canvas, 0, 0);
    acc.globalAlpha = 1;
    acc.globalCompositeOperation = 'source-over';
  }
  const c = layer.getContext('2d')!;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(acc.canvas, 0, 0);
  c.restore();
}
