import type { Clip } from '../model/types';

/** Linear fade multiplier (0..1) at timeline time `t` for a clip with fade-in/out lengths in seconds. */
export function fadeAlpha(clip: Pick<Clip, 'start' | 'duration'>, fadeIn: number, fadeOut: number, t: number) {
  const local = t - clip.start;
  let a = 1;
  if (fadeIn > 0) a = Math.min(a, local / fadeIn);
  if (fadeOut > 0) a = Math.min(a, (clip.duration - local) / fadeOut);
  return Math.max(0, Math.min(1, a));
}

/** Audio gain of a clip at time t: volume × fades. */
export const clipGainAt = (clip: Clip, t: number) =>
  clip.audio.volume * fadeAlpha(clip, clip.audio.fadeIn, clip.audio.fadeOut, t);
