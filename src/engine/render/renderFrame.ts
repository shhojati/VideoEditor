// The one composite function shared by preview and export (plan §4.1): given the project, a time
// and already-decoded frames, draw the frame. Synchronous and free of hidden state.
import { clipVisibleRange, cutTime } from '../../model/transitions';
import type { Clip, Project, Track, Transform, Transition } from '../../model/types';
import { drawSubtitles } from './subtitles';
import { drawTextClip } from './text';
import { drawTransition } from './transitions';

/** Anything with display dimensions that can draw itself (Mediabunny VideoSample fits this). */
export interface Drawable {
  displayWidth: number;
  displayHeight: number;
  draw(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number): void;
}

/** Returns the decoded frame to show for a clip, if it is available. */
export type FrameLookup = (clip: Clip) => Drawable | undefined;

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

export interface Placement {
  /** Rectangle (centred on the origin, before rotation) the whole source frame is drawn into. */
  frame: { x: number; y: number; w: number; h: number };
  /** Visible (cropped) rectangle, same space; used as the clip path. */
  visible: { x: number; y: number; w: number; h: number };
  /** Centre of the visible rectangle on the canvas. */
  cx: number;
  cy: number;
  rotation: number;
}

/** Where a source of srcW×srcH lands on a canvas of canvasW×canvasH for a transform. Pure. */
export function placeMedia(srcW: number, srcH: number, canvasW: number, canvasH: number, tr: Transform): Placement {
  const crop = tr.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const visW = srcW * crop.width;
  const visH = srcH * crop.height;
  const fitScale = (tr.fit === 'cover' ? Math.max : Math.min)(canvasW / visW, canvasH / visH) * tr.scale;
  const w = visW * fitScale;
  const h = visH * fitScale;
  const fullW = srcW * fitScale;
  const fullH = srcH * fitScale;
  return {
    visible: { x: -w / 2, y: -h / 2, w, h },
    frame: { x: -w / 2 - crop.x * fullW, y: -h / 2 - crop.y * fullH, w: fullW, h: fullH },
    cx: canvasW / 2 + tr.x * canvasW,
    cy: canvasH / 2 + tr.y * canvasH,
    rotation: (tr.rotation * Math.PI) / 180,
  };
}

/** Draw one clip as it looks at time t. The context's alpha/transform/filter are respected. */
export function drawClip(ctx: Ctx2D, clip: Clip, t: number, lookup: FrameLookup, width: number, height: number) {
  if (clip.text) {
    // Inside a transition a text clip may be drawn outside its own range: hold its edge state.
    const tc = Math.min(clip.start + clip.duration - 1e-3, Math.max(clip.start, t));
    drawTextClip(ctx, clip, tc, width, height);
    return;
  }
  const src = lookup(clip);
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
  for (const item of drawPlanAt(project, t)) {
    if (item.kind === 'clip') drawClip(ctx, item.clip, t, lookup, width, height);
    else
      drawTransition(ctx, item.transition.kind, item.progress, width, height,
        () => drawClip(ctx, item.from, t, lookup, width, height),
        () => drawClip(ctx, item.to, t, lookup, width, height),
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
