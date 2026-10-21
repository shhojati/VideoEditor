// Offline audio mix for export (workers have no Web Audio): each audible clip's decoded source audio
// is resampled to the output rate with linear interpolation, following the clip's speed, multiplied
// by the same volume/fade curve the player uses, and summed into stereo output buffers. Voice
// effects run the same chains as the preview, in the same order: voice → gain → space.
import { peakVolume } from '../../model/keyframes';
import type { Clip, Project, Track } from '../../model/types';
import { hasVoiceStage, SPACE_TAIL, spaceMixAt, voiceParamsAt } from '../../model/voiceFx';
import { CleanChain, hasCleanStage, type NoiseProfile } from '../audio/cleanDsp';
import { SpaceChain, VoiceChain, voiceLatency } from '../audio/voiceDsp';
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
 * audible range, shaped by its gain envelope (fades, transition crossfades), with its cleanup and
 * voice effects (a space effect rings on past the range). `noise` = the asset's noise profile.
 */
export function mixClip(
  out: [Float32Array, Float32Array],
  outRate: number,
  clip: Clip,
  src: DecodedRange,
  env: AudioEnvelope = audioEnvelope(clip),
  noise?: NoiseProfile,
) {
  if (hasVoiceStage(clip) || hasCleanStage(clip) || clip.audio.space) {
    mixClipFx(out, outRate, clip, src, env, noise);
    return;
  }
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

/** Samples per chunk of the effects path (keeps memory flat on long clips). */
const CHUNK = 8192;

function mixClipFx(
  out: [Float32Array, Float32Array],
  outRate: number,
  clip: Clip,
  src: DecodedRange,
  env: AudioEnvelope,
  noise: NoiseProfile | undefined,
) {
  const { space, voice, clean } = clip.audio;
  const cleanChain = hasCleanStage(clip) ? new CleanChain(clean!, outRate, noise) : undefined;
  const voiceChain = hasVoiceStage(clip) ? new VoiceChain(voice?.kind, outRate, (t) => voiceParamsAt(clip, t)) : undefined;
  const spaceChain = space ? new SpaceChain(space, outRate, (t) => spaceMixAt(clip, t, env.end)) : undefined;
  // The cleanup and voice stages delay their output: feed them that many samples ahead.
  const lead = (voiceChain ? voiceLatency(outRate) : 0) + (cleanChain?.latency ?? 0);
  const first = Math.floor(env.start * outRate);
  const last = Math.min(out[0].length, Math.ceil((env.end + (space ? SPACE_TAIL : 0)) * outRate));
  const left = src.channels[0];
  const right = src.channels[1] ?? left;
  const n = left.length;
  const buf: [Float32Array, Float32Array] = [new Float32Array(CHUNK), new Float32Array(CHUNK)];
  for (let i0 = first - lead; i0 < last; i0 += CHUNK) {
    const len = Math.min(CHUNK, last - i0);
    for (let j = 0; j < len; j++) {
      const t = (i0 + j + lead) / outRate;
      buf[0][j] = buf[1][j] = 0;
      if (t < env.start || t >= env.end) continue;
      const pos = (clip.inPoint + (t - clip.start) * clip.speed - src.start) * src.rate;
      const k = Math.floor(pos);
      if (k < 0 || k >= n) continue;
      const f = pos - k;
      const k1 = Math.min(n - 1, k + 1);
      buf[0][j] = left[k] + (left[k1] - left[k]) * f;
      buf[1][j] = right[k] + (right[k1] - right[k]) * f;
    }
    // From here on, buf[*][j] is timeline sample i0 + j.
    cleanChain?.process(buf, len);
    voiceChain?.process(buf, len, i0 / outRate);
    for (let j = 0; j < len; j++) {
      const g = env.gainAt((i0 + j) / outRate);
      buf[0][j] *= g;
      buf[1][j] *= g;
    }
    spaceChain?.process(buf, len, i0 / outRate);
    for (let j = Math.max(0, first - i0); j < len; j++) {
      out[0][i0 + j] += buf[0][j];
      out[1][i0 + j] += buf[1][j];
    }
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
