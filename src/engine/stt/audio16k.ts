// Mixing decoded clip audio onto a 16 kHz mono timeline buffer for speech-to-text.
// Each output sample is the average of the input samples that fall into it (a box filter): cheap,
// and plenty for speech when going 44.1/48 kHz -> 16 kHz.
import { sourceLength, timelineTimeAt, type Timing } from '../../model/remap';

export const STT_RATE = 16_000;

/** Accumulates one clip's samples into output bins, then adds the averages into a mix. */
export class BinAccumulator {
  private readonly sum: Float32Array;
  private readonly count: Uint16Array;
  /** Loudest accepted sample (absolute), for diagnostics. */
  peak = 0;

  /** `firstBin` = output index of the clip's timeline start; `bins` = how many outputs it spans. */
  constructor(
    private readonly firstBin: number,
    bins: number,
  ) {
    this.sum = new Float32Array(Math.max(0, bins));
    this.count = new Uint16Array(Math.max(0, bins));
  }

  /**
   * Add planar samples (all channels averaged to mono). `outPos(i)` maps input frame i of this chunk
   * to a fractional output position on the timeline. Returns how many frames landed inside the clip.
   */
  push(channels: Float32Array[], outPos: (i: number) => number): number {
    const frames = channels[0]?.length ?? 0;
    const nch = channels.length;
    let used = 0;
    for (let i = 0; i < frames; i++) {
      const b = Math.floor(outPos(i)) - this.firstBin;
      if (b < 0 || b >= this.sum.length) continue;
      let v = 0;
      for (let c = 0; c < nch; c++) v += channels[c][i];
      v /= nch;
      this.sum[b] += v;
      this.count[b] = Math.min(65535, this.count[b] + 1);
      this.peak = Math.max(this.peak, Math.abs(v));
      used++;
    }
    return used;
  }

  /** Add this clip's averaged samples × gain into the timeline mix. */
  addInto(mix: Float32Array, gain: number) {
    for (let b = 0; b < this.sum.length; b++) {
      const o = this.firstBin + b;
      if (o >= 0 && o < mix.length && this.count[b]) mix[o] += (this.sum[b] / this.count[b]) * gain;
    }
  }
}

/** Decoded audio as the mix reads it: planar channels starting at `timestamp` (source seconds). */
export interface AudioChunk {
  channels: Float32Array[];
  timestamp: number;
  sampleRate: number;
}

/** Reads a file's audio, from..to in source seconds, or all of it when no range is given. */
export type ReadAudio = (from?: number, to?: number) => AsyncIterable<AudioChunk>;

/** What one clip gave the mix; shown when the mix turns out silent. */
export interface MixStats {
  codec?: string | null;
  sampleRate?: number;
  channels?: number;
  /** Frames decoded / frames that landed inside the clip. */
  frames: number;
  used: number;
  /** First and last chunk timestamps (source seconds). */
  first?: number;
  last?: number;
  peak: number;
  /** The ranged read gave nothing usable, so the whole file was read. */
  retried?: boolean;
}

/**
 * Mix one clip into `mix` (16 kHz timeline buffer). Reads only the clip's source range; if that
 * yields nothing inside the clip (seen on some Android decoders), reads the whole file instead,
 * the way the waveform does.
 */
export async function mixClip(mix: Float32Array, item: Timing & { gain: number }, read: ReadAudio): Promise<MixStats> {
  const pass = async (ranged: boolean) => {
    const acc = new BinAccumulator(Math.floor(item.start * STT_RATE), Math.ceil(item.duration * STT_RATE) + 1);
    const stats: MixStats = { frames: 0, used: 0, peak: 0 };
    const chunks = ranged ? read(item.inPoint, item.inPoint + sourceLength(item)) : read();
    for await (const { channels, timestamp, sampleRate } of chunks) {
      stats.first ??= timestamp;
      stats.last = timestamp;
      stats.sampleRate = sampleRate;
      stats.channels = channels.length;
      stats.frames += channels[0]?.length ?? 0;
      // Source time -> timeline time -> 16 kHz output position.
      stats.used += acc.push(channels, (i) => timelineTimeAt(item, timestamp + i / sampleRate) * STT_RATE);
    }
    stats.peak = acc.peak;
    return { acc, stats };
  };
  let { acc, stats } = await pass(true);
  if (!stats.used) {
    ({ acc, stats } = await pass(false));
    stats.retried = true;
  }
  acc.addInto(mix, item.gain);
  return stats;
}

const round = (n: number, d: number) => Number(n.toFixed(d));

/** One short line per clip, e.g. `1: aac 48000Hz 2ch, 0/0 frames, ts -, peak 0 (retried)`. */
export function describeMix(stats: readonly MixStats[]): string {
  if (!stats.length) return 'no audible clips';
  return stats
    .map((s, i) => {
      const ts = s.first === undefined ? '-' : `${round(s.first, 2)}..${round(s.last ?? s.first, 2)}s`;
      const fmt = [s.codec ?? '?', s.sampleRate ? `${s.sampleRate}Hz` : '', s.channels ? `${s.channels}ch` : ''].filter(Boolean).join(' ');
      return `${i + 1}: ${fmt}, ${s.used}/${s.frames} frames, ts ${ts}, peak ${round(s.peak, 4)}${s.retried ? ' (retried)' : ''}`;
    })
    .join('; ');
}
