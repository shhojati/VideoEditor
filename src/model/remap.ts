// Time remapping: where in its source a clip is at a timeline time, and back. The one place that
// knows about speed, speed curves, reverse and freeze frames; everything else (render, audio,
// export, keyframes, masks, tracking, timeline edits) asks here.
//
// A clip plays the source range [inPoint, inPoint + L]. Its speed is `speed`, or `speedCurve`:
// absolute speeds at points of normalized clip time u = (t - start) / duration, linear in between.
// Source advanced after u is duration · E(u), E(u) = ∫₀ᵘ v. Reversed clips play the range from
// its end; freeze clips hold the frame at inPoint.
import type { Clip, SpeedPoint } from './types';

export type Timing = Pick<Clip, 'start' | 'duration' | 'inPoint' | 'speed' | 'speedCurve' | 'reversed' | 'freeze'>;

export const SPEED_RANGE = { min: 0.1, max: 10 } as const;

interface Table {
  u: Float64Array;
  v: Float64Array;
  /** E at each knot. */
  e: Float64Array;
}

const tables = new WeakMap<readonly SpeedPoint[], Table>();

function table(curve: readonly SpeedPoint[]): Table {
  let t = tables.get(curve);
  if (!t) {
    const n = curve.length;
    const u = Float64Array.from(curve, (p) => p[0]);
    const v = Float64Array.from(curve, (p) => p[1]);
    const e = new Float64Array(n);
    for (let i = 1; i < n; i++) e[i] = e[i - 1] + ((v[i - 1] + v[i]) / 2) * (u[i] - u[i - 1]);
    t = { u, v, e };
    tables.set(curve, t);
  }
  return t;
}

const segmentOf = (arr: Float64Array, x: number) => {
  let i = 0;
  while (i < arr.length - 2 && x >= arr[i + 1]) i++;
  return i;
};

/** Speed (absolute, unsigned) at normalized time u; constant past the ends. */
export function speedAtU(c: Pick<Clip, 'speed' | 'speedCurve'>, u: number): number {
  if (!c.speedCurve) return c.speed;
  const { u: us, v } = table(c.speedCurve);
  if (u <= 0) return v[0];
  if (u >= 1) return v[v.length - 1];
  const i = segmentOf(us, u);
  return v[i] + ((v[i + 1] - v[i]) * (u - us[i])) / (us[i + 1] - us[i]);
}

/** E(u) = ∫₀ᵘ v, extended past the ends at the edge speeds. */
function integral(c: Pick<Clip, 'speed' | 'speedCurve'>, u: number): number {
  if (!c.speedCurve) return c.speed * u;
  const { u: us, v, e } = table(c.speedCurve);
  const last = us.length - 1;
  if (u <= 0) return v[0] * u;
  if (u >= 1) return e[last] + v[last] * (u - 1);
  const i = segmentOf(us, u);
  const w = u - us[i];
  const a = (v[i + 1] - v[i]) / (us[i + 1] - us[i]);
  return e[i] + v[i] * w + (a * w * w) / 2;
}

/** u with E(u) = x (E is strictly increasing: speeds are > 0). */
function inverseIntegral(c: Pick<Clip, 'speed' | 'speedCurve'>, x: number): number {
  if (!c.speedCurve) return x / c.speed;
  const { u: us, v, e } = table(c.speedCurve);
  const last = us.length - 1;
  if (x <= 0) return x / v[0];
  if (x >= e[last]) return 1 + (x - e[last]) / v[last];
  const i = segmentOf(e, x);
  const d = x - e[i];
  const a = (v[i + 1] - v[i]) / (us[i + 1] - us[i]);
  // Root of a/2·w² + v·w − d = 0, in the form that stays stable when a → 0.
  return us[i] + (2 * d) / (v[i] + Math.sqrt(Math.max(0, v[i] * v[i] + 2 * a * d)));
}

/** How fast the key clock runs (for snapping keyframes to frames): 1 for a freeze frame. */
export const keyRate = (c: Timing) => (c.freeze ? 1 : meanSpeed(c));

/** Average speed over the clip (source seconds per timeline second). */
export const meanSpeed = (c: Pick<Clip, 'speed' | 'speedCurve'>) => (c.speedCurve ? table(c.speedCurve).e.at(-1)! : c.speed);

/** Length of the source range the clip plays (0 for a freeze frame). */
export const sourceLength = (c: Timing) => (c.freeze ? 0 : c.speedCurve ? c.duration * meanSpeed(c) : c.duration * c.speed);

/** True for a plain clip: forward at one constant speed (most clips; the old fast paths). */
export const isLinear = (c: Timing) => !c.speedCurve && !c.reversed && !c.freeze;

/** Source time shown at timeline time t (extrapolated past the clip's edges, for handles). */
export function mediaTimeAt(c: Timing, t: number): number {
  if (c.freeze) return c.inPoint;
  if (!c.speedCurve) {
    if (!c.reversed) return c.inPoint + (t - c.start) * c.speed;
    return c.inPoint + (c.start + c.duration - t) * c.speed;
  }
  const D = c.duration;
  const advanced = D * integral(c, D > 0 ? (t - c.start) / D : 0);
  return c.reversed ? c.inPoint + sourceLength(c) - advanced : c.inPoint + advanced;
}

/** Timeline time at which source time s is shown (a freeze frame: its start). */
export function timelineTimeAt(c: Timing, s: number): number {
  if (c.freeze) return c.start;
  if (!c.speedCurve) {
    if (!c.reversed) return c.start + (s - c.inPoint) / c.speed;
    return c.start + c.duration - (s - c.inPoint) / c.speed;
  }
  const D = c.duration;
  const advanced = c.reversed ? c.inPoint + sourceLength(c) - s : s - c.inPoint;
  return c.start + D * inverseIntegral(c, D > 0 ? advanced / D : 0);
}

/** Signed source speed at t (ds/dt): negative when reversed, 0 for a freeze frame. */
export function speedAt(c: Timing, t: number): number {
  if (c.freeze) return 0;
  const v = speedAtU(c, c.duration > 0 ? (t - c.start) / c.duration : 0);
  return c.reversed ? -v : v;
}

/** Source range shown between timeline times t0 ≤ t1. */
export function sourceRangeFor(c: Timing, t0: number, t1: number): { from: number; to: number } {
  const a = mediaTimeAt(c, t0);
  const b = mediaTimeAt(c, t1);
  return { from: Math.min(a, b), to: Math.max(a, b) };
}

/**
 * Timeline seconds of unused source before the clip's start and after its end ("handles", for
 * transitions and outward trims). `mediaDuration` undefined = unlimited (images, unknown).
 */
export function handles(c: Timing, mediaDuration: number | undefined): { before: number; after: number } {
  if (c.freeze) return { before: Infinity, after: Infinity };
  const startEdge = speedAtU(c, 0);
  const endEdge = speedAtU(c, 1);
  const head = c.inPoint;
  const tail = mediaDuration === undefined ? Infinity : Math.max(0, mediaDuration - (c.inPoint + sourceLength(c)));
  return c.reversed ? { before: tail / startEdge, after: head / endEdge } : { before: head / startEdge, after: tail / endEdge };
}

/**
 * The clock keyframes and mask keys use: source time for media clips (so they stay on the
 * content through trims and speed changes), time since the start for a freeze frame.
 */
export const keyTimeAt = (c: Timing, t: number) => (c.freeze ? t - c.start : mediaTimeAt(c, t));
export const keyToTimeline = (c: Timing, k: number) => (c.freeze ? c.start + k : timelineTimeAt(c, k));

/**
 * Timing for the part of the clip between timeline times a < b (a split half, or a trim; outside
 * the clip the edge speeds continue). Keeps every frame where it was on the timeline.
 */
export function retime(c: Timing, a: number, b: number): Pick<Clip, 'start' | 'duration' | 'inPoint'> & { speedCurve?: SpeedPoint[] } {
  const duration = b - a;
  if (c.freeze) return { start: a, duration, inPoint: c.inPoint };
  const inPoint = Math.max(0, Math.min(mediaTimeAt(c, a), mediaTimeAt(c, b)));
  if (!c.speedCurve) return { start: a, duration, inPoint };
  // Old knots inside [a, b] keep their speed; new end knots get the (extrapolated) speed there.
  const D = c.duration;
  const toNew = (u: number) => (c.start + u * D - a) / duration;
  const toOld = (u2: number) => (a + u2 * duration - c.start) / D;
  const points: SpeedPoint[] = [[0, speedAtU(c, toOld(0))]];
  for (const [u, v] of c.speedCurve) {
    const u2 = toNew(u);
    if (u2 > 1e-9 && u2 < 1 - 1e-9) points.push([u2, v]);
  }
  points.push([1, speedAtU(c, toOld(1))]);
  return { start: a, duration, inPoint, speedCurve: points };
}
