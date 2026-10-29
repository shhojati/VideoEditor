// The one composite function shared by preview and export (plan §4.1): given the project, a time
// and already-decoded frames, draw the frame. Synchronous and free of hidden state.
import { clipVisibleRange, cutTime } from '../../model/transitions';
import type { Clip, Project, Track, Transition } from '../../model/types';
import { keyedClip } from '../../model/keyframes';
import { isOverlay, isPaintLayer } from '../../model/overlays';
import { touchesPixels } from '../../model/paint';
import { applyEffects, hasLiveEffects, type FxEnv } from '../effects/applyEffects';
import { drawBlended, seedOf } from './blend';
import { applyMasks, resolveMasks, type Affine, type ResolvedMasks } from './masks';
import { withMotion } from './motion';
import { withParent } from './parenting';
import { placeMedia } from './placement';
import { drawPaint } from './paint';
import { drawShapeClip } from './shapes';
import { drawSubtitles } from './subtitles';
import { drawTextClip } from './text';
import { drawTransition } from './transitions';
import { keyTimeAt, mediaTimeAt } from '../../model/remap';
import { MAX_NEST, sequenceDuration, sequenceView } from '../../model/sequences';
import { trackShows } from '../../model/visibility';

/** Anything with display dimensions that can draw itself (Mediabunny VideoSample fits this). */
export interface Drawable {
  displayWidth: number;
  displayHeight: number;
  draw(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number): void;
}

/** Returns the decoded frame to show for a clip at timeline time t, if it is available. */
export type FrameLookup = (clip: Clip, t: number) => Drawable | undefined;

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Time inside the source media that the clip shows at timeline time `t` (extends past trim points). */
export const sourceTimeAt = (clip: Clip, t: number) => mediaTimeAt(clip, t);

export const isActiveAt = (clip: Clip, t: number) => t >= clip.start && t < clip.start + clip.duration;

/**
 * Visual clips whose picture is needed at time `t`, bottom layer first: the clip under the
 * playhead plus, during a transition, the clip on the other side of the cut.
 */
export function visualClipsAt(project: Project, t: number): { clip: Clip; track: Track }[] {
  const out: { clip: Clip; track: Track }[] = [];
  for (const track of project.tracks) {
    if (track.kind === 'audio' || !trackShows(project, track)) continue;
    for (const clip of track.clips) {
      const r = track.transitions?.length ? clipVisibleRange(track, clip) : { start: clip.start, end: clip.start + clip.duration };
      if (t >= r.start && t < r.end) out.push({ clip, track });
    }
  }
  return out;
}

export type TrackDraw =
  | { kind: 'clip'; clip: Clip }
  | { kind: 'transition'; transition: Transition; from: Clip; to: Clip; progress: number };

/** What each visual track shows at time t: one clip, or a transition between two. Bottom first. */
export function drawPlanAt(project: Project, t: number): TrackDraw[] {
  const plan: TrackDraw[] = [];
  for (const track of project.tracks) {
    if (track.kind === 'audio' || !trackShows(project, track)) continue;
    const tr = track.transitions?.find((x) => {
      const from = track.clips.find((c) => c.id === x.fromClipId);
      if (!from) return false;
      const cut = cutTime(from);
      return t >= cut - x.duration / 2 && t < cut + x.duration / 2;
    });
    if (tr) {
      const from = track.clips.find((c) => c.id === tr.fromClipId)!;
      const to = track.clips.find((c) => c.id === tr.toClipId)!;
      const progress = (t - (cutTime(from) - tr.duration / 2)) / tr.duration;
      plan.push({ kind: 'transition', transition: tr, from, to, progress: Math.min(1, Math.max(0, progress)) });
      continue;
    }
    for (const clip of track.clips) if (isActiveAt(clip, t)) plan.push({ kind: 'clip', clip });
  }
  return plan;
}

export { placeMedia, type Placement } from './placement';

/** Where effects run: the frame on the canvas and the pixel scale, from the context's transform. */
function effectEnv(ctx: Ctx2D, clip: Clip, t: number, width: number, height: number): FxEnv {
  const m = ctx.getTransform();
  const scale = Math.hypot(m.a, m.b);
  return {
    key: clip.id,
    time: t,
    local: Math.max(0, t - clip.start),
    duration: clip.duration,
    scale,
    unit: (scale * Math.min(width, height)) / 1080,
    frame: { x: m.e, y: m.f, w: width * m.a, h: height * m.d },
    below: ctx.canvas,
  };
}

const matrixOf = (m: DOMMatrix): Affine => [m.a, m.b, m.c, m.d, m.e, m.f];

/**
 * Draw one clip as it looks at time t, with its masks, effects and blend mode. The context's
 * alpha/transform/filter are respected. An adjustment layer applies its effects to what has been
 * drawn so far instead (limited to its masks).
 */
export function drawClip(
  ctx: Ctx2D,
  clip: Clip,
  t: number,
  lookup: FrameLookup,
  width: number,
  height: number,
  masks?: ResolvedMasks,
  luts?: Project['luts'],
) {
  // Dancing Dissolve re-rolls its pattern 30 times a second; Dissolve keeps one per clip.
  const seed = clip.blend === 'dancingDissolve' ? seedOf(clip.id) ^ Math.floor(t * 30) : seedOf(clip.id);
  const effects = clip.effects;
  const fx = hasLiveEffects(effects) ? (layer: OffscreenCanvas) => void applyEffects(layer, effects!, { ...effectEnv(ctx, clip, t, width, height), luts }) : undefined;
  const view = masks && matrixOf(ctx.getTransform());
  const cut = masks && ((layer: OffscreenCanvas) => applyMasks(layer, masks, view!));
  if (clip.adjustment) {
    if (!fx || clip.transform.opacity <= 0) return;
    const copyBelow = (c: Ctx2D) => {
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(ctx.canvas, 0, 0);
      c.restore();
    };
    // The effects run on the whole picture below, then the masks limit where they show.
    const post = cut
      ? (layer: OffscreenCanvas) => {
          fx(layer);
          cut(layer);
        }
      : fx;
    drawBlended(ctx, clip.blend, copyBelow, { seed, post, alpha: clip.transform.opacity });
    return;
  }
  // A clip is cut out first, so its effects (glow, shadow…) follow the cut-out's edge. Paint that
  // rubs out or copies the clip's pixels needs the clip on a layer of its own.
  const own = !isOverlay(clip) && touchesPixels(clip.paint) ? () => {} : undefined;
  const post =
    cut && fx
      ? (layer: OffscreenCanvas) => {
          cut(layer);
          fx(layer);
        }
      : (cut ?? fx ?? own);
  // A paint layer's clone strokes copy what is drawn below it.
  const below = ctx.canvas;
  drawBlended(ctx, clip.blend, (c) => drawClipPixels(c, clip, t, lookup, width, height, below), { seed, post });
}

function drawClipPixels(ctx: Ctx2D, clip: Clip, t: number, lookup: FrameLookup, width: number, height: number, below?: CanvasImageSource) {
  if (isOverlay(clip)) {
    // Inside a transition an overlay may be drawn outside its own range: hold its edge state.
    const tc = Math.min(clip.start + clip.duration - 1e-3, Math.max(clip.start, t));
    if (clip.text) drawTextClip(ctx, clip, tc, width, height);
    else if (clip.shape) drawShapeClip(ctx, clip, tc, width, height);
    else if (isPaintLayer(clip)) drawPaintLayer(ctx, clip, tc, width, height, below);
    else if (clip.solid) drawSolid(ctx, clip, width, height);
    return;
  }
  const src = lookup(clip, t);
  if (!src || clip.transform.opacity <= 0) return;
  const p = placeMedia(src.displayWidth, src.displayHeight, width, height, clip.transform);
  ctx.save();
  ctx.globalAlpha *= clip.transform.opacity;
  ctx.translate(p.cx, p.cy);
  if (p.rotation) ctx.rotate(p.rotation);
  if (clip.transform.crop) {
    ctx.beginPath();
    ctx.rect(p.visible.x, p.visible.y, p.visible.w, p.visible.h);
    ctx.clip();
  }
  src.draw(ctx, p.frame.x, p.frame.y, p.frame.w, p.frame.h);
  if (clip.paint) {
    // Strokes are in source pixels over the uncropped picture.
    ctx.translate(p.frame.x, p.frame.y);
    ctx.scale(p.frame.w / src.displayWidth, p.frame.h / src.displayHeight);
    drawPaint(ctx, clip.paint, keyTimeAt(clip, t), clip.id);
  }
  ctx.restore();
}

/** A solid layer: the frame's size in its colour, around the clip's position. */
function drawSolid(ctx: Ctx2D, clip: Clip, width: number, height: number) {
  const tr = clip.transform;
  if (tr.opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha *= tr.opacity;
  ctx.translate(width / 2 + tr.x * width, height / 2 + tr.y * height);
  if (tr.rotation) ctx.rotate((tr.rotation * Math.PI) / 180);
  ctx.scale(tr.scale, tr.scale);
  ctx.fillStyle = clip.solid!.color;
  ctx.fillRect(-width / 2, -height / 2, width, height);
  ctx.restore();
}

/** A paint layer: its strokes around the clip's position (project pixels at scale 1). */
function drawPaintLayer(ctx: Ctx2D, clip: Clip, t: number, width: number, height: number, below?: CanvasImageSource) {
  const tr = clip.transform;
  if (tr.opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha *= tr.opacity;
  ctx.translate(width / 2 + tr.x * width, height / 2 + tr.y * height);
  if (tr.rotation) ctx.rotate((tr.rotation * Math.PI) / 180);
  ctx.scale(tr.scale, tr.scale);
  drawPaint(ctx, clip.paint!, keyTimeAt(clip, t), clip.id, below);
  ctx.restore();
}

export interface RenderOptions {
  /** Burn in subtitle tracks (default true; the exporter can turn it off). */
  subtitles?: boolean;
}

/** Draw the composite frame at time `t` into a context whose user space is project pixels. */
export function renderFrame(project: Project, t: number, ctx: Ctx2D, lookup: FrameLookup, opts: RenderOptions = {}) {
  const { width, height } = project.settings;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  drawTracks(project, t, ctx, lookup, 0);
  if (opts.subtitles !== false) drawSubtitles(ctx, project, t, width, height);
  ctx.restore();
}

/** Offscreen layers compound clips draw their insides into, one per nesting level. */
const layers: OffscreenCanvas[] = [];

/**
 * A compound clip as a picture: its sequence drawn (transparent where empty) at the sequence time
 * the clip shows, at the resolution it ends up on screen. Then it is placed, masked, blended and
 * given effects like any media.
 */
function compoundDrawable(project: Project, clip: Clip, t: number, lookup: FrameLookup, depth: number): Drawable | undefined {
  const seqId = clip.sequenceId!;
  if (depth >= MAX_NEST || !project.sequences?.[seqId]) return undefined;
  const { width: W, height: H } = project.settings;
  // Past the end of what is inside (e.g. after deleting clips in it) the compound shows nothing.
  const at = Math.max(0, mediaTimeAt(clip, t));
  if (at >= sequenceDuration(project, seqId)) return undefined;
  return {
    displayWidth: W,
    displayHeight: H,
    draw(ctx, dx, dy, dw, dh) {
      const m = ctx.getTransform();
      const k = Math.min(1, Math.max(0.05, (Math.hypot(m.a, m.b) * dw) / W));
      const w = Math.max(1, Math.round(W * k));
      const h = Math.max(1, Math.round(H * k));
      const layer = (layers[depth] ??= new OffscreenCanvas(w, h));
      if (layer.width !== w || layer.height !== h) {
        layer.width = w;
        layer.height = h;
      }
      const c = layer.getContext('2d')!;
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, w, h);
      c.setTransform(k, 0, 0, k, 0, 0);
      drawTracks(sequenceView(project, seqId), at, c, lookup, depth + 1);
      ctx.drawImage(layer, dx, dy, dw, dh);
    },
  };
}

/** A group with nothing of its own to apply to its picture as a whole: its clips draw in place. */
export const passesThrough = (clip: Clip) =>
  !!clip.group && (clip.blend ?? 'normal') === 'normal' && !hasLiveEffects(clip.effects) && !clip.masks?.length && !clip.transform.crop && !clip.paint && !clip.adjustment;

/**
 * A pass-through group: its tracks drawn straight onto `ctx` under the group's transform, so blend
 * modes inside it blend with what is below and parts moving past the frame are not cut. Below full
 * opacity the parts are drawn over a copy of the backdrop and that fades in as one, so the group
 * fades as a whole (parts do not show through each other) while their blends still see the scene.
 */
function drawGroupInPlace(project: Project, clip: Clip, t: number, ctx: Ctx2D, base: FrameLookup, depth: number) {
  const seqId = clip.sequenceId!;
  const opacity = clip.transform.opacity;
  if (depth >= MAX_NEST || !project.sequences?.[seqId] || opacity <= 0) return;
  const at = Math.max(0, mediaTimeAt(clip, t));
  if (at >= sequenceDuration(project, seqId)) return;
  const { width: W, height: H } = project.settings;
  const p = placeMedia(W, H, W, H, clip.transform);
  const inside = (c: Ctx2D) => {
    c.save();
    c.translate(p.cx, p.cy);
    if (p.rotation) c.rotate(p.rotation);
    c.translate(p.frame.x, p.frame.y);
    c.scale(p.frame.w / W, p.frame.h / H);
    drawTracks(sequenceView(project, seqId), at, c, base, depth + 1);
    c.restore();
  };
  if (opacity * ctx.globalAlpha >= 1) {
    inside(ctx);
    return;
  }
  const backdropThenParts = (c: Ctx2D) => {
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(ctx.canvas, 0, 0);
    c.restore();
    inside(c);
  };
  drawBlended(ctx, 'normal', backdropThenParts, { post: () => {}, alpha: opacity });
}

/** Every visual track of a timeline at time t, bottom to top (compound clips draw their insides). */
function drawTracks(project: Project, t: number, ctx: Ctx2D, base: FrameLookup, depth: number) {
  const { width, height } = project.settings;
  const lookup: FrameLookup = (clip, tt) => (clip.sequenceId ? compoundDrawable(project, clip, tt, base, depth) : base(clip, tt));
  // Keyframes first, then clips linked to a tracker are drawn where the tracked object takes them,
  // then a parent carries its children; masks move with them.
  const draw = (clip: Clip) => {
    const keyed = keyedClip(clip, t);
    const moved = withParent(project, withMotion(project, keyed, t), t);
    if (moved.sequenceId && passesThrough(moved)) drawGroupInPlace(project, moved, t, ctx, base, depth);
    else drawClip(ctx, moved, t, lookup, width, height, resolveMasks(project, keyed, t, moved), project.luts);
  };
  for (const item of drawPlanAt(project, t)) {
    if (item.kind === 'clip') draw(item.clip);
    else
      drawTransition(ctx, item.transition.kind, item.progress, width, height,
        () => draw(item.from),
        () => draw(item.to),
      );
  }
}

/**
 * Source time for decoding: like sourceTimeAt, but kept inside the media. Past the trim points
 * (transitions) without spare footage, this holds the first/last frame.
 */
export function frameSourceTime(clip: Clip, t: number, mediaDuration: number | undefined) {
  const s = sourceTimeAt(clip, t);
  return Math.max(0, mediaDuration === undefined ? s : Math.min(s, mediaDuration - 1e-3));
}
