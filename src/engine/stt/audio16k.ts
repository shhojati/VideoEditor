// Mixing decoded clip audio onto a 16 kHz mono timeline buffer for speech-to-text.
// Each output sample is the average of the input samples that fall into it (a box filter): cheap,
// and plenty for speech when going 44.1/48 kHz -> 16 kHz.

export const STT_RATE = 16_000;

/** Accumulates one clip's samples into output bins, then adds the averages into a mix. */
export class BinAccumulator {
  private readonly sum: Float32Array;
  private readonly count: Uint16Array;

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
   * to a fractional output position on the timeline.
   */
  push(channels: Float32Array[], outPos: (i: number) => number) {
    const frames = channels[0]?.length ?? 0;
    const nch = channels.length;
    for (let i = 0; i < frames; i++) {
      const b = Math.floor(outPos(i)) - this.firstBin;
      if (b < 0 || b >= this.sum.length) continue;
      let v = 0;
      for (let c = 0; c < nch; c++) v += channels[c][i];
      this.sum[b] += v / nch;
      this.count[b] = Math.min(65535, this.count[b] + 1);
    }
  }

  /** Add this clip's averaged samples × gain into the timeline mix. */
  addInto(mix: Float32Array, gain: number) {
    for (let b = 0; b < this.sum.length; b++) {
      const o = this.firstBin + b;
      if (o >= 0 && o < mix.length && this.count[b]) mix[o] += (this.sum[b] / this.count[b]) * gain;
    }
  }
}
