// Auto ducking: music clips with "duck under voice" get quieter wherever another audible clip has
// speech. Speech activity comes from each asset's waveform peaks (already computed for the
// timeline); the main thread turns it into a plan of timeline intervals per ducked clip, which
// both the preview (audioEngine) and the export worker (audioMix) apply through audioEnvelope.
import { peakVolume } from '../../model/keyframes';
import type { Clip, ClipDuck, Project } from '../../model/types';

export type Interval = [number, number];
/** Speech intervals in source seconds for an asset, or undefined while its waveform is not ready. */
export type ActivityOf = (assetId: string) => Interval[] | undefined;
/** Timeline intervals each ducked clip ducks under, by clip id. */
export type DuckPlan = Record<string, Interval[]>;

export const DUCK_DEFAULTS: ClipDuck = { amount: -12, attack: 0.3, release: 0.6 };
/** Pauses shorter than this inside speech do not let the music come back up. */
const BRIDGE = 0.4;
/** Blips shorter than this are not speech. */
const MIN_RUN = 0.15;

/**
 * Where an asset is loud enough to be speech, from min/max waveform peak pairs. The threshold
 * adapts to the recording (a share of its loud level) so quiet and hot recordings both work.
 */
export function activityFromPeaks(peaks: Float32Array, peaksPerSecond: number): Interval[] {
  const n = peaks.length >> 1;
  if (!n) return [];
  const amp = new Float32Array(n);
  for (let i = 0; i < n; i++) amp[i] = Math.max(Math.abs(peaks[2 * i]), Math.abs(peaks[2 * i + 1]));
  const sorted = Float32Array.from(amp).sort();
  const loud = sorted[Math.floor(n * 0.95)];
  const threshold = Math.max(0.02, loud * 0.2);
  const runs: Interval[] = [];
  let from = -1;
  for (let i = 0; i <= n; i++) {
    const on = i < n && amp[i] >= threshold;
    if (on && from < 0) from = i;
    if (!on && from >= 0) {
      runs.push([from / peaksPerSecond, i / peaksPerSecond]);
      from = -1;
    }
  }
  return mergeIntervals(runs, BRIDGE).filter(([a, b]) => b - a >= MIN_RUN);
}

/** Sort and join intervals that overlap or are closer than `gap`. */
export function mergeIntervals(list: Interval[], gap = 0): Interval[] {
  const out: Interval[] = [];
  for (const [a, b] of [...list].sort((x, y) => x[0] - y[0])) {
    const last = out.at(-1);
    if (last && a - last[1] <= gap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** A clip's activity on the timeline (source → timeline time, cut to the clip). */
function clipActivity(clip: Clip, source: Interval[]): Interval[] {
  const end = clip.start + clip.duration;
  const out: Interval[] = [];
  for (const [a, b] of source) {
    const t0 = Math.max(clip.start, clip.start + (a - clip.inPoint) / clip.speed);
    const t1 = Math.min(end, clip.start + (b - clip.inPoint) / clip.speed);
    if (t1 > t0) out.push([t0, t1]);
  }
  return out;
}

/** For every clip set to duck: the timeline intervals with speech in the other (not ducked) clips. */
export function duckPlan(project: Project, activityOf: ActivityOf): DuckPlan {
  const voice: Interval[] = [];
  const ducked: Clip[] = [];
  for (const track of project.tracks) {
    if (track.muted || track.kind === 'text') continue;
    for (const clip of track.clips) {
      const asset = clip.assetId ? project.assets[clip.assetId] : undefined;
      if (!asset || asset.kind === 'image' || (asset.kind === 'video' && !asset.hasAudio)) continue;
      if (clip.audio.duck) ducked.push(clip);
      else if (peakVolume(clip) > 0) voice.push(...clipActivity(clip, activityOf(asset.id) ?? []));
    }
  }
  const plan: DuckPlan = {};
  for (const clip of ducked) {
    const d = { ...DUCK_DEFAULTS, ...clip.audio.duck };
    // Close gaps the music could not recover in anyway: no pumping between words.
    const merged = mergeIntervals(voice, d.attack + d.release);
    const lo = clip.start - d.release;
    const hi = clip.start + clip.duration + d.attack;
    const mine = merged.filter(([a, b]) => b > lo && a < hi);
    if (mine.length) plan[clip.id] = mine;
  }
  return plan;
}

/**
 * Gain factor (≤ 1) of a ducked clip at time t: down to `amount` dB over `attack` seconds before
 * speech starts (the plan is known ahead, so the music is already down when the voice begins),
 * back up over `release` after it ends.
 */
export function duckGainAt(intervals: Interval[], duck: ClipDuck, t: number): number {
  const floor = 10 ** (duck.amount / 20);
  const attack = Math.max(1e-3, duck.attack);
  const release = Math.max(1e-3, duck.release);
  let depth = 0;
  for (const [a, b] of intervals) {
    if (t >= a - attack && t < a) depth = Math.max(depth, (t - (a - attack)) / attack);
    else if (t >= a && t <= b) return floor;
    else if (t > b && t <= b + release) depth = Math.max(depth, 1 - (t - b) / release);
  }
  return 1 - (1 - floor) * depth;
}

/** Where the duck gain changes (for gain automation). */
export function duckRamps(intervals: Interval[], duck: ClipDuck): Interval[] {
  return intervals.flatMap(([a, b]): Interval[] => [
    [a - duck.attack, a],
    [b, b + duck.release],
  ]);
}
