// Geometry for on-canvas editing: where each visual clip sits (a rotated box in project pixels)
// and how move / resize / rotate gestures change it. Pure, so it is unit tested.
import { layoutText } from '../../engine/render/text';
import { arrowSize } from '../../engine/render/shapes';
import { isActiveAt, placeMedia } from '../../engine/render/renderFrame';
import { keepsAspect } from '../../model/overlays';
import type { Clip, Project, Track } from '../../model/types';

export interface Pt {
  x: number;
  y: number;
}

/** A clip's on-canvas rectangle: centre, size and rotation (radians, clockwise). Project pixels. */
export interface Box {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

type Measure = Parameters<typeof layoutText>[0];

/** Smallest box a resize may produce (project px). */
export const MIN_BOX = 4;

export function clipBox(project: Project, clip: Clip, measure: Measure): Box | null {
  const { width: W, height: H } = project.settings;
  const tr = clip.transform;
  const rotation = (tr.rotation * Math.PI) / 180;
  const centre = { cx: W / 2 + tr.x * W, cy: H / 2 + tr.y * H, rotation };
  if (clip.shape) {
    const s = clip.shape;
    const k = tr.scale;
    const h = s.kind === 'line' ? Math.max(s.strokeWidth * k, s.arrowStart || s.arrowEnd ? arrowSize(s.strokeWidth * k) * 1.1 : 0, 1) : s.height * k;
    return { ...centre, w: s.width * k, h };
  }
  if (clip.text) {
    const l = layoutText(measure, clip, W);
    // An empty text still gets a grabbable box.
    return { ...centre, w: Math.max(l.boxW, l.size), h: Math.max(l.boxH, l.lineH) };
  }
  const asset = clip.assetId ? project.assets[clip.assetId] : undefined;
  if (!asset?.width || !asset.height || asset.kind === 'audio') return null;
  const p = placeMedia(asset.width, asset.height, W, H, tr);
  return { cx: p.cx, cy: p.cy, w: p.visible.w, h: p.visible.h, rotation: p.rotation };
}

const rot = (p: Pt, a: number): Pt => ({ x: p.x * Math.cos(a) - p.y * Math.sin(a), y: p.x * Math.sin(a) + p.y * Math.cos(a) });

/** Point in the box's own frame (origin at its centre, unrotated). */
export const toLocal = (b: Box, p: Pt): Pt => rot({ x: p.x - b.cx, y: p.y - b.cy }, -b.rotation);
export const toWorld = (b: Box, q: Pt): Pt => {
  const r = rot(q, b.rotation);
  return { x: b.cx + r.x, y: b.cy + r.y };
};

/** The four corners, clockwise from top-left. */
export const corners = (b: Box): Pt[] =>
  [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([sx, sy]) => toWorld(b, { x: (sx * b.w) / 2, y: (sy * b.h) / 2 }));

export function contains(b: Box, p: Pt, tolerance = 0) {
  const q = toLocal(b, p);
  return Math.abs(q.x) <= b.w / 2 + tolerance && Math.abs(q.y) <= b.h / 2 + tolerance;
}

/** Visual clips under the playhead, topmost first, on unlocked tracks. */
export function editableClipsAt(project: Project, t: number): { clip: Clip; track: Track }[] {
  const out: { clip: Clip; track: Track }[] = [];
  for (let i = project.tracks.length - 1; i >= 0; i--) {
    const track = project.tracks[i];
    if (track.kind === 'audio' || track.locked) continue;
    for (const clip of track.clips) if (isActiveAt(clip, t)) out.push({ clip, track });
  }
  return out;
}

/** Which handles a clip offers: media and text scale uniformly, shapes resize freely. */
export function handlesFor(clip: Clip): { corners: boolean; edges: boolean; rotate: boolean; ends: boolean } {
  if (clip.shape?.kind === 'line') return { corners: false, edges: false, rotate: false, ends: true };
  return { corners: true, edges: !!clip.shape && !keepsAspect(clip.shape.kind), rotate: true, ends: false };
}

// ---- gestures -------------------------------------------------------------------------------------

/**
 * Resize by dragging the handle at (sx, sy) ∈ {-1, 0, 1}² (corners have both non-zero, edges one)
 * to `p`. The opposite handle stays put, or the centre with `fromCentre`. `uniform` keeps the
 * aspect ratio.
 */
export function resizeBox(b: Box, sx: number, sy: number, p: Pt, uniform: boolean, fromCentre: boolean): Box {
  const q = toLocal(b, p);
  const hw = b.w / 2;
  const hh = b.h / 2;
  const a = fromCentre ? { x: 0, y: 0 } : { x: -sx * hw, y: -sy * hh };
  let w: number;
  let h: number;
  let c: Pt;
  if (uniform) {
    // Scale factor: projection of the pointer onto the anchor → handle direction.
    const d = { x: sx * hw - a.x, y: sy * hh - a.y };
    const len2 = d.x * d.x + d.y * d.y;
    const minF = MIN_BOX / Math.min(b.w, b.h);
    const f = Math.max(minF, len2 > 0 ? ((q.x - a.x) * d.x + (q.y - a.y) * d.y) / len2 : 1);
    w = b.w * f;
    h = b.h * f;
    c = { x: a.x * (1 - f), y: a.y * (1 - f) };
  } else {
    const axis = (s: number, qv: number, av: number, len: number) => {
      if (!s) return { len, c: 0 };
      if (fromCentre) return { len: Math.max(MIN_BOX, 2 * s * qv), c: 0 };
      const l = Math.max(MIN_BOX, s * (qv - av));
      return { len: l, c: av + (s * l) / 2 };
    };
    const ax = axis(sx, q.x, a.x, b.w);
    const ay = axis(sy, q.y, a.y, b.h);
    w = ax.len;
    h = ay.len;
    c = { x: ax.c, y: ay.c };
  }
  const wc = toWorld(b, c);
  return { cx: wc.x, cy: wc.y, w, h, rotation: b.rotation };
}

const SNAP_ANGLE = Math.PI / 12; // 15°

/** Rotation that points the box's top towards `p` (the rotate handle sits above the top edge). */
export function rotateTowards(b: Box, p: Pt, snap: boolean): number {
  let a = Math.atan2(p.y - b.cy, p.x - b.cx) + Math.PI / 2;
  if (snap) a = Math.round(a / SNAP_ANGLE) * SNAP_ANGLE;
  return a;
}

/** Move one end (-1 start, 1 end) of a line to `p`; the other end stays. */
export function moveLineEnd(b: Box, end: -1 | 1, p: Pt, snap: boolean): Box {
  const other = toWorld(b, { x: (-end * b.w) / 2, y: 0 });
  // Direction start → end.
  const from = end === 1 ? other : p;
  const to = end === 1 ? p : other;
  let angle = Math.atan2(to.y - from.y, to.x - from.x);
  let len = Math.max(MIN_BOX, Math.hypot(to.x - from.x, to.y - from.y));
  if (snap) {
    angle = Math.round(angle / SNAP_ANGLE) * SNAP_ANGLE;
    const proj = (p.x - other.x) * Math.cos(angle) * end + (p.y - other.y) * Math.sin(angle) * end;
    len = Math.max(MIN_BOX, proj);
  }
  const mid = { x: other.x + (end * Math.cos(angle) * len) / 2, y: other.y + (end * Math.sin(angle) * len) / 2 };
  return { cx: mid.x, cy: mid.y, w: len, h: b.h, rotation: angle };
}

/**
 * Snap a moved box's centre to the frame centre lines and, when unrotated, its edges to the frame
 * edges. `threshold` is in project pixels. Returns the adjusted centre and the guides hit.
 */
export function snapMove(b: Box, W: number, H: number, threshold: number): { cx: number; cy: number; guides: { x?: number; y?: number } } {
  const axis = (c: number, half: number, len: number, unrotated: boolean) => {
    // [position on the box, frame line it snaps to]
    const targets: [number, number][] = [[c, len / 2]]; // centre → centre line
    if (unrotated) targets.push([c - half, 0], [c + half, len]); // near edge → frame edge
    let best: { d: number; at: number } | null = null;
    for (const [pos, line] of targets) {
      const d = line - pos;
      if (Math.abs(d) <= threshold && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, at: line };
    }
    return best;
  };
  const unrotated = Math.abs(Math.sin(b.rotation * 2)) < 1e-6;
  // A box turned by 90° has its sides swapped.
  const quarter = unrotated && Math.abs(Math.sin(b.rotation)) > 0.5;
  const halfX = (quarter ? b.h : b.w) / 2;
  const halfY = (quarter ? b.w : b.h) / 2;
  const sx = axis(b.cx, halfX, W, unrotated);
  const sy = axis(b.cy, halfY, H, unrotated);
  return { cx: b.cx + (sx?.d ?? 0), cy: b.cy + (sy?.d ?? 0), guides: { x: sx?.at, y: sy?.at } };
}

/** Normalised degrees in (-180, 180]. */
const toDegrees = (rad: number) => {
  let d = ((rad * 180) / Math.PI) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return Math.round(d * 100) / 100;
};

/**
 * Write a box back into the clip: position and rotation always; size as width/height for shapes,
 * otherwise as the uniform scale (relative to the box at gesture start, `from`).
 */
export function applyBox(clip: Clip, from: Box, to: Box, W: number, H: number, fromScale: number) {
  clip.transform.x = (to.cx - W / 2) / W;
  clip.transform.y = (to.cy - H / 2) / H;
  clip.transform.rotation = toDegrees(to.rotation);
  if (clip.shape) {
    const k = clip.transform.scale;
    const px = (v: number) => Math.round((v / k) * 10) / 10;
    clip.shape.width = px(to.w);
    if (clip.shape.kind !== 'line') clip.shape.height = px(keepsAspect(clip.shape.kind) ? to.w : to.h);
  } else if (from.w > 0) clip.transform.scale = Math.max(0.01, fromScale * (to.w / from.w));
}
