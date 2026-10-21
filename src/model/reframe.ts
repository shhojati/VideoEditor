// Auto reframe: turn per-frame subject detections into a calm virtual camera path. Pure; the
// detection itself is in features/tracking/reframeService.ts.
import type { TrackSample } from './types';

/** One analysed frame: source time and the subject centre (fractions of the frame), if found. */
export interface Detection {
  s: number;
  x?: number;
  y?: number;
}

/** The camera does not move while the subject stays within this distance (fraction of the frame). */
const DEAD_ZONE = 0.06;
/** Fastest camera move, frames per second (a fraction of the frame width/height per second). */
const MAX_SPEED = 0.5;

/** Average over ±half seconds, with as many neighbours on each side (so the ends do not lurch). */
function movingAverage(values: number[], times: number[], half: number): number[] {
  return values.map((_, i) => {
    let left = 0;
    while (i - left - 1 >= 0 && times[i] - times[i - left - 1] <= half) left++;
    let right = 0;
    while (i + right + 1 < values.length && times[i + right + 1] - times[i] <= half) right++;
    const k = Math.min(left, right);
    let sum = 0;
    for (let j = i - k; j <= i + k; j++) sum += values[j];
    return sum / (2 * k + 1);
  });
}

/** Follow `target` only when it leaves the dead zone, at most MAX_SPEED. */
function lazyFollow(target: number[], times: number[]): number[] {
  const out: number[] = [];
  let cam = target[0];
  for (let i = 0; i < target.length; i++) {
    const dt = i ? times[i] - times[i - 1] : 0;
    const d = target[i] - cam;
    if (Math.abs(d) > DEAD_ZONE) cam += Math.sign(d) * Math.min(Math.abs(d) - DEAD_ZONE / 2, MAX_SPEED * dt);
    out.push(cam);
  }
  return out;
}

/**
 * Camera path for the detections: gaps hold the last seen position (the first one before any),
 * nothing at all keeps the centre; then a 1 s average, the lazy follow, and a short average to
 * ease its starts and stops. As tracker samples (angle 0, scale 1).
 */
export function cameraPath(detections: Detection[]): TrackSample[] {
  if (!detections.length) return [];
  const firstSeen = detections.find((d) => d.x !== undefined);
  let x = firstSeen?.x ?? 0.5;
  let y = firstSeen?.y ?? 0.5;
  const xs: number[] = [];
  const ys: number[] = [];
  const times = detections.map((d) => d.s);
  for (const d of detections) {
    if (d.x !== undefined && d.y !== undefined) {
      x = d.x;
      y = d.y;
    }
    xs.push(x);
    ys.push(y);
  }
  const path = [xs, ys].map((v) => movingAverage(lazyFollow(movingAverage(v, times, 0.5), times), times, 0.2));
  return detections.map((d, i): TrackSample => [d.s, path[0][i], path[1][i], 0, 1]);
}

/** The point to frame for a face: a little below its centre, so the head gets some room above. */
export const faceTarget = (box: { x: number; y: number; w: number; h: number }) => ({ x: box.x + box.w / 2, y: box.y + box.h * 0.65 });
/** The point to frame for a person: the upper body. */
export const personTarget = (box: { x: number; y: number; w: number; h: number }) => ({ x: box.x + box.w / 2, y: box.y + box.h * 0.3 });
