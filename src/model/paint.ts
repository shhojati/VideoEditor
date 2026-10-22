// Brush strokes (After Effects' paint): which strokes show at a time, how far a Write On stroke
// has drawn itself, and frame-by-frame drawings. Pure, so it is unit tested.
import type { PaintProps, PaintStroke } from './types';

/** A stroke as it shows at a time: `upTo` is how much of its length is drawn (Write On), 0..1. */
export interface ShownStroke {
  stroke: PaintStroke;
  upTo: number;
}

/** Half a frame at 60 fps: a stroke starting "now" shows at the frame it was drawn on. */
const EPS = 1 / 120;

/** Strokes showing at source time s, in painting order. */
export function strokesAt(paint: PaintProps | undefined, s: number): ShownStroke[] {
  const out: ShownStroke[] = [];
  for (const stroke of paint?.strokes ?? []) {
    if (s < stroke.start - EPS) continue;
    if (stroke.duration !== undefined && s >= stroke.start + stroke.duration - EPS) continue;
    const upTo = stroke.writeOn ? Math.min(1, Math.max(0, (s - stroke.start) / stroke.writeOn)) : 1;
    if (upTo > 0) out.push({ stroke, upTo });
  }
  return out;
}

/** Number of points in a stroke (points are stored as x, y, pressure). */
export const pointCount = (points: number[]) => Math.floor(points.length / 3);

/** The points of the first `upTo` (0..1) of the stroke's length, as [x, y, pressure] triples. */
export function pointsUpTo(points: number[], upTo: number): [number, number, number][] {
  const n = pointCount(points);
  const all: [number, number, number][] = [];
  for (let i = 0; i < n; i++) all.push([points[3 * i], points[3 * i + 1], points[3 * i + 2]]);
  if (upTo >= 1 || n < 2) return all;
  let total = 0;
  for (let i = 1; i < n; i++) total += Math.hypot(all[i][0] - all[i - 1][0], all[i][1] - all[i - 1][1]);
  const want = total * upTo;
  const out: [number, number, number][] = [all[0]];
  let run = 0;
  for (let i = 1; i < n; i++) {
    const [a, b] = [all[i - 1], all[i]];
    const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (run + d >= want) {
      // The last point lands part way along this segment.
      const u = d > 0 ? (want - run) / d : 0;
      out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]);
      return out;
    }
    run += d;
    out.push(b);
  }
  return out;
}

/** Strokes that rub out or copy the clip's own pixels (it then needs a layer of its own to draw into). */
export const touchesPixels = (paint: PaintProps | undefined) => !!paint?.strokes.some((s) => s.tool !== 'brush');

// ---- frame-by-frame -------------------------------------------------------------------------------

/** Start (source time) of the drawing showing at source time s, when each holds `hold` frames. */
export function celStart(s: number, hold: number, fps: number) {
  const len = hold / fps;
  return Math.floor(s / len + 1e-6) * len;
}

/** The previous (-1) or next (1) drawing's start from the one at s. */
export const celStep = (s: number, hold: number, fps: number, dir: -1 | 1) => Math.max(0, celStart(s, hold, fps) + (dir * hold) / fps);

/** Start and length (source time) for a stroke drawn at source time s: its drawing in frame-by-frame mode. */
export function newStrokeTiming(paint: PaintProps | undefined, s: number, fps: number): { start: number; duration?: number } {
  if (!paint?.frames) return { start: s };
  const hold = paint.frames.hold;
  return { start: celStart(s, hold, fps), duration: hold / fps };
}

/** Rounded to a thousandth (keeps stored points small). */
export const round3 = (v: number) => Math.round(v * 1000) / 1000;
