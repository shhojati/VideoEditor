import { volumeAt, volumeRamp } from '../model/keyframes';
import { DUCK_DEFAULTS, duckGainAt, duckRamps, type Interval } from './audio/ducking';
import { transitionsOfClip } from '../model/transitions';
import type { Clip, Track, Transition } from '../model/types';
import { handles } from '../model/remap';

/** Linear fade multiplier (0..1) at timeline time `t` for a clip with fade-in/out lengths in seconds. */
export function fadeAlpha(clip: Pick<Clip, 'start' | 'duration'>, fadeIn: number, fadeOut: number, t: number) {
  const local = t - clip.start;
  let a = 1;
  if (fadeIn > 0) a = Math.min(a, local / fadeIn);
  if (fadeOut > 0) a = Math.min(a, (clip.duration - local) / fadeOut);
  return Math.max(0, Math.min(1, a));
}

/** Audio gain of a clip at time t: volume (keyframes applied) × fades (no transitions). */
export const clipGainAt = (clip: Clip, t: number) =>
  volumeAt(clip, t) * fadeAlpha(clip, clip.audio.fadeIn, clip.audio.fadeOut, t);

export interface AudioEnvelope {
  /** Interval in which the clip is audible (extended by transition crossfades). */
  start: number;
  end: number;
  gainAt(t: number): number;
  /** Disjoint intervals where the gain changes; constant in between. */
  ramps: [number, number][];
}

/** Length of a clip's source media in seconds (undefined = unlimited, e.g. unknown). */
export type MediaDuration = (clip: Clip) => number | undefined;

/**
 * Audio crossfade window of a transition: the part of the (centred) transition window where BOTH
 * clips have real audio — before the cut the incoming clip needs material before its in-point,
 * after the cut the outgoing clip needs material past its out-point. Without such "handles" the
 * window shrinks towards the cut (a clean cut instead of a dip).
 */
export function audioCrossfadeWindow(track: Track, tr: Transition, mediaDuration: MediaDuration): [number, number] {
  const from = track.clips.find((c) => c.id === tr.fromClipId)!;
  const to = track.clips.find((c) => c.id === tr.toClipId)!;
  const cut = from.start + from.duration;
  const afterFrom = handles(from, mediaDuration(from)).after;
  const beforeTo = handles(to, mediaDuration(to)).before;
  const half = tr.duration / 2;
  return [cut - Math.max(0, Math.min(half, beforeTo)), cut + Math.max(0, Math.min(half, afterFrom))];
}

/**
 * Gain over time for a clip on a track. A side with a transition gets an equal-power crossfade over
 * the cut's audio window (sin in / cos out, so the two clips keep a constant total power) instead
 * of the clip's own fade on that side. A clip set to duck also follows its plan (`duck`, timeline
 * intervals with speech; see engine/audio/ducking.ts).
 */
export function audioEnvelope(
  clip: Clip,
  track?: Track,
  mediaDuration: MediaDuration = () => undefined,
  duck?: Interval[],
): AudioEnvelope {
  const duckSettings = clip.audio.duck && duck?.length ? { ...DUCK_DEFAULTS, ...clip.audio.duck } : undefined;
  const tr = track ? transitionsOfClip(track, clip.id) : {};
  const s = clip.start;
  const e = clip.start + clip.duration;
  const inWin = tr.in ? audioCrossfadeWindow(track!, tr.in, mediaDuration) : null;
  const outWin = tr.out ? audioCrossfadeWindow(track!, tr.out, mediaDuration) : null;
  const start = inWin ? inWin[0] : s;
  const end = outWin ? outWin[1] : e;
  const usable = (w: [number, number] | null) => !!w && w[1] - w[0] > 1e-3;
  const inRamp: [number, number] | null = usable(inWin) ? inWin : !tr.in && clip.audio.fadeIn > 0 ? [s, s + clip.audio.fadeIn] : null;
  const outRamp: [number, number] | null = usable(outWin) ? outWin : !tr.out && clip.audio.fadeOut > 0 ? [e - clip.audio.fadeOut, e] : null;

  const gainAt = (t: number) => {
    if (t < start || t > end) return 0;
    let g = volumeAt(clip, t);
    if (usable(inWin)) {
      if (t < inWin![1]) g *= Math.sin(((t - inWin![0]) / (inWin![1] - inWin![0])) * (Math.PI / 2));
    } else if (!tr.in && clip.audio.fadeIn > 0) g *= Math.max(0, Math.min(1, (t - s) / clip.audio.fadeIn));
    if (usable(outWin)) {
      if (t > outWin![0]) g *= Math.cos(((t - outWin![0]) / (outWin![1] - outWin![0])) * (Math.PI / 2));
    } else if (!tr.out && clip.audio.fadeOut > 0) g *= Math.max(0, Math.min(1, (e - t) / clip.audio.fadeOut));
    if (duckSettings) g *= duckGainAt(duck!, duckSettings, t);
    if (clip.audio.gainDb) g *= 10 ** (clip.audio.gainDb / 20);
    return Math.max(0, g);
  };

  const ramps: [number, number][] = [];
  const keyed = volumeRamp(clip);
  const volRamp: [number, number] | null = keyed ? [Math.max(start, keyed[0]), Math.min(end, keyed[1])] : null;
  const duckRanges = duckSettings ? duckRamps(duck!, duckSettings).map(([a, b]): [number, number] => [Math.max(start, a), Math.min(end, b)]) : [];
  for (const r of [inRamp, volRamp, outRamp, ...duckRanges].sort((a, b) => (a?.[0] ?? 0) - (b?.[0] ?? 0))) {
    if (!r || r[1] - r[0] <= 0) continue;
    const last = ramps.at(-1);
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
    else ramps.push([...r]);
  }
  return { start, end, gainAt, ramps };
}
