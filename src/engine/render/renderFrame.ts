// The one composite function shared by preview and export (plan §4.1): given the project, a time
// and already-decoded frames, draw the frame. Synchronous and free of hidden state.
import { clipVisibleRange, cutTime } from '../../model/transitions';
import type { Clip, Project, Track, Transition } from '../../model/types';
import { isOverlay } from '../../model/overlays';
import { applyEffects, hasLiveEffects, type FxEnv } from '../effects/applyEffects';
import { drawBlended, seedOf } from './blend';
import { withMotion } from './motion';
import { placeMedia } from './placement';
import { drawShapeClip } from './shapes';
import { drawSubtitles } from './subtitles';
import { drawTextClip } from './text';
import { drawTransition } from './transitions';

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
export const sourceTimeAt = (clip: Clip, t: number) => clip.inPoint + (t - clip.start) * clip.speed;

export const isActiveAt = (clip: Clip, t: number) => t >= clip.start && t < clip.start + clip.duration;

/**
 * Visual clips whose picture is needed at time `t`, bottom layer first: the clip under the
 * playhead plus, during a transition, the clip on the other side of the cut.
 */
export function visualClipsAt(project: Project, t: number): { clip: Clip; track: Track }[] {
  const out: { clip: Clip; track: Track }[] = [];
  for (const track of project.tracks) {
    if (track.kind === 'audio') continue;
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
    if (track.kind === 'audio') continue;
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

/**
 * Draw one clip as it looks at time t, with its effects and blend mode. The context's
 * alpha/transform/filter are respected. An adjustment layer applies its effects to what has been
 * drawn so far instead.
 */
export function drawClip(ctx: Ctx2D, clip: Clip, t: number, lookup: FrameLookup, width: number, height: number) {
  // Dancing Dissolve re-rolls its pattern 30 times a second; Dissolve keeps one per clip.
  const seed = clip.blend === 'dancingDissolve' ? seedOf(clip.id) ^ Math.floor(t * 30) : seedOf(clip.id);
  const effects = clip.effects;
  const post = hasLiveEffects(effects) ? (layer: OffscreenCanvas) => void applyEffects(layer, effects!, effectEnv(ctx, clip, t, width, height)) : undefined;
  if (clip.adjustment) {
    if (!post || clip.transform.opacity <= 0) return;
    const copyBelow = (c: Ctx2D) => {
      c.save();
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.drawImage(ctx.canvas, 0, 0);
      c.restore();
    };
    const view = ctx.getTransform();
    const masked = clip.mask
      ? (layer: OffscreenCanvas) => {
          post(layer);
          maskLayer(layer, clip, view, width, height);
        }
      : post;
    drawBlended(ctx, clip.blend, copyBelow, { seed, post: masked, alpha: clip.transform.opacity });
    return;
  }
  drawBlended(ctx, clip.blend, (c) => drawClipPixels(c, clip, t, lookup, width, height), { seed, post });
}

let maskCanvas: OffscreenCanvas | null = null;

/**
 * Keep only the part of `layer` inside the clip's mask (placed by its transform; `view` maps project
 * pixels to the layer). A soft edge is drawn as the shadow of a shape moved out of sight, which
 * blurs the same way everywhere (unlike ctx.filter, it works in every browser and in workers).
 */
function maskLayer(layer: OffscreenCanvas, clip: Clip, view: DOMMatrix, width: number, height: number) {
  const mask = clip.mask!;
  const tr = clip.transform;
  if (!maskCanvas || maskCanvas.width !== layer.width || maskCanvas.height !== layer.height) maskCanvas = new OffscreenCanvas(layer.width, layer.height);
  const m = maskCanvas.getContext('2d')!;
  m.setTransform(1, 0, 0, 1, 0, 0);
  m.clearRect(0, 0, layer.width, layer.height);
  const feather = mask.feather * tr.scale * Math.hypot(view.a, view.b);
  const off = feather > 0.5 ? layer.width + layer.height + 4 * feather : 0;
  m.setTransform(view.a, view.b, view.c, view.d, view.e - off, view.f);
  m.translate(width / 2 + tr.x * width, height / 2 + tr.y * height);
  m.rotate((tr.rotation * Math.PI) / 180);
  m.scale(tr.scale, tr.scale);
  m.beginPath();
  if (mask.kind === 'ellipse') m.ellipse(0, 0, mask.width / 2, mask.height / 2, 0, 0, 2 * Math.PI);
  else m.rect(-mask.width / 2, -mask.height / 2, mask.width, mask.height);
  m.fillStyle = '#000';
  if (off) {
    m.shadowColor = '#000';
    m.shadowBlur = feather;
    m.shadowOffsetX = off;
  }
  m.fill();
  m.shadowColor = 'transparent';
  const c = layer.getContext('2d')!;
  c.save();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'destination-in';
  c.drawImage(maskCanvas, 0, 0);
  c.restore();
}

function drawClipPixels(ctx: Ctx2D, clip: Clip, t: number, lookup: FrameLookup, width: number, height: number) {
  if (isOverlay(clip)) {
    // Inside a transition an overlay may be drawn outside its own range: hold its edge state.
    const tc = Math.min(clip.start + clip.duration - 1e-3, Math.max(clip.start, t));
    if (clip.text) drawTextClip(ctx, clip, tc, width, height);
    else drawShapeClip(ctx, clip, tc, width, height);
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
  // Clips linked to a tracker are drawn where the tracked object takes them.
  const moved = (clip: Clip) => withMotion(project, clip, t);
  for (const item of drawPlanAt(project, t)) {
    if (item.kind === 'clip') drawClip(ctx, moved(item.clip), t, lookup, width, height);
    else
      drawTransition(ctx, item.transition.kind, item.progress, width, height,
        () => drawClip(ctx, moved(item.from), t, lookup, width, height),
        () => drawClip(ctx, moved(item.to), t, lookup, width, height),
      );
  }
  if (opts.subtitles !== false) drawSubtitles(ctx, project, t, width, height);
  ctx.restore();
}

/**
 * Source time for decoding: like sourceTimeAt, but kept inside the media. Past the trim points
 * (transitions) without spare footage, this holds the first/last frame.
 */
export function frameSourceTime(clip: Clip, t: number, mediaDuration: number | undefined) {
  const s = sourceTimeAt(clip, t);
  return Math.max(0, mediaDuration === undefined ? s : Math.min(s, mediaDuration - 1e-3));
}
