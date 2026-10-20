// The one composite function shared by preview and export (plan §4.1): given the project, a time
// and already-decoded frames, draw the frame. Synchronous and free of hidden state.
import type { Clip, Project, Track, Transform } from '../../model/types';
import { drawTextClip } from './text';

/** Anything with display dimensions that can draw itself (Mediabunny VideoSample fits this). */
export interface Drawable {
  displayWidth: number;
  displayHeight: number;
  draw(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, dx: number, dy: number, dw: number, dh: number): void;
}

/** Returns the decoded frame to show for a clip, if it is available. */
export type FrameLookup = (clip: Clip) => Drawable | undefined;

export type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** Time inside the source media that the clip shows at timeline time `t`. */
export const sourceTimeAt = (clip: Clip, t: number) => clip.inPoint + (t - clip.start) * clip.speed;

export const isActiveAt = (clip: Clip, t: number) => t >= clip.start && t < clip.start + clip.duration;

/** Visual clips under time `t`, bottom layer first. */
export function visualClipsAt(project: Project, t: number): { clip: Clip; track: Track }[] {
  const out: { clip: Clip; track: Track }[] = [];
  for (const track of project.tracks) {
    if (track.kind === 'audio') continue;
    for (const clip of track.clips) if (isActiveAt(clip, t)) out.push({ clip, track });
  }
  return out;
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
  const fitScale =
    (tr.fit === 'cover' ? Math.max : Math.min)(canvasW / visW, canvasH / visH) * tr.scale;
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

/** Draw the composite frame at time `t` into a context whose user space is project pixels. */
export function renderFrame(project: Project, t: number, ctx: Ctx2D, lookup: FrameLookup) {
  const { width, height } = project.settings;
  ctx.save();
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  for (const { clip } of visualClipsAt(project, t)) {
    if (clip.text) {
      drawTextClip(ctx, clip, t, width, height);
      continue;
    }
    const src = lookup(clip);
    if (!src || clip.transform.opacity <= 0) continue;
    const p = placeMedia(src.displayWidth, src.displayHeight, width, height, clip.transform);
    ctx.save();
    ctx.globalAlpha = clip.transform.opacity;
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
  ctx.restore();
}
