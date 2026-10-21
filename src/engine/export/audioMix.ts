// Offline audio mix for export (workers have no Web Audio): each audible clip's decoded source audio
// is resampled to the output rate with linear interpolation, following the clip's speed, multiplied
// by the same volume/fade curve the player uses, and summed into stereo output buffers.
import { peakVolume } from '../../model/keyframes';
import type { Clip, Project, Track } from '../../model/types';
import { audioEnvelope, type AudioEnvelope } from '../fade';

export interface DecodedRange {
  /** Planar source samples (1 or 2+ channels). */
  channels: Float32Array[];
  rate: number;
  /** Source time (s) of channels[*][0]. */
  start: number;
}

/**
 * Add one clip into the stereo mix (`out[0]`, `out[1]` at `outRate`, index 0 = timeline 0 s) over its
 * audible range, shaped by its gain envelope (fades, transition crossfades).
 */
export function mixClip(
  out: [Float32Array, Float32Array],
  outRate: number,
  clip: Clip,
  src: DecodedRange,
  env: AudioEnvelope = audioEnvelope(clip),
) {
  const first = Math.max(0, Math.floor(env.start * outRate));
  const last = Math.min(out[0].length, Math.ceil(env.end * outRate));
  const left = src.channels[0];
  const right = src.channels[1] ?? left;
  const n = left.length;
  for (let i = first; i < last; i++) {
    const t = i / outRate;
    if (t < env.start || t >= env.end) continue;
    const pos = (clip.inPoint + (t - clip.start) * clip.speed - src.start) * src.rate;
    const k = Math.floor(pos);
    if (k < 0 || k >= n) continue;
    const f = pos - k;
    const k1 = Math.min(n - 1, k + 1);
    const g = env.gainAt(t);
    out[0][i] += (left[k] + (left[k1] - left[k]) * f) * g;
    out[1][i] += (right[k] + (right[k1] - right[k]) * f) * g;
  }
}

/** Clips that make sound: on unmuted audio/video tracks, with a decodable audio source. */
export function audibleClips(project: Project, only?: ReadonlySet<string>): { clip: Clip; track: Track; opfsPath: string }[] {
  const out: { clip: Clip; track: Track; opfsPath: string }[] = [];
  for (const track of project.tracks) {
    if (track.muted || track.kind === 'text') continue;
    for (const clip of track.clips) {
      if (only && !only.has(clip.id)) continue;
      const asset = clip.assetId ? project.assets[clip.assetId] : undefined;
      if (!asset?.fileRef.opfsPath || peakVolume(clip) <= 0) continue;
      if (asset.kind === 'audio' || (asset.kind === 'video' && asset.hasAudio)) out.push({ clip, track, opfsPath: asset.fileRef.opfsPath });
    }
  }
  return out;
}

/** Hard clip to [-1, 1] after summing (keeps the AAC encoder away from overs). */
export function limit(buffers: Float32Array[]) {
  for (const b of buffers) for (let i = 0; i < b.length; i++) b[i] = b[i] > 1 ? 1 : b[i] < -1 ? -1 : b[i];
}
