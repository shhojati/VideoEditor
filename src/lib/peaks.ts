/**
 * Builds a min/max waveform at a fixed number of buckets per second from audio chunks that may arrive
 * with arbitrary sizes and timestamps (decoder output). Output layout: [min0, max0, min1, max1, ...].
 */
export class PeakBuilder {
  private readonly peaks: Float32Array;
  readonly bucketCount: number;

  constructor(
    duration: number,
    readonly peaksPerSecond: number,
  ) {
    this.bucketCount = Math.max(1, Math.ceil(duration * peaksPerSecond));
    this.peaks = new Float32Array(this.bucketCount * 2);
  }

  /** `channels` are planar float samples; all channels are folded into one envelope. */
  push(channels: Float32Array[], sampleRate: number, timestamp: number) {
    const frames = channels[0]?.length ?? 0;
    const bucketsPerFrame = this.peaksPerSecond / sampleRate;
    const first = timestamp * this.peaksPerSecond;
    for (let i = 0; i < frames; i++) {
      const b = Math.floor(first + i * bucketsPerFrame);
      if (b < 0) continue;
      if (b >= this.bucketCount) break;
      for (const ch of channels) {
        const v = ch[i];
        if (v < this.peaks[2 * b]) this.peaks[2 * b] = v;
        if (v > this.peaks[2 * b + 1]) this.peaks[2 * b + 1] = v;
      }
    }
  }

  result(): Float32Array {
    return this.peaks;
  }
}
