// Voice effect processing, shared by the preview (an AudioWorklet) and export (the worker mix), so
// both sound the same. Streaming and stateful: chains process stereo audio in place, in fixed
// 128-sample sub-blocks counted from their first sample, with settings read once per sub-block, so
// the output does not depend on how callers slice the audio. No DOM, no Web Audio.
import {
  SPACE_PRESETS,
  VOICE_PRESETS,
  type VoiceParams,
  type VoiceRecipe,
} from '../../model/voiceFx';
import type { SpaceFx, VoiceKind } from '../../model/types';

export const BLOCK = 128;
/** Pitch shifter grain (s): long enough for deep voices, short enough to keep words crisp. */
const GRAIN = 0.06;
const RATIO_RANGE = [0.25, 4] as const;

/** Delay (in samples) the voice stage adds; hosts feed it this much early. */
export const voiceLatency = (rate: number) => Math.round(GRAIN * rate) >> 1;

type Stereo = [Float32Array, Float32Array];

/** A circular delay line read with linear interpolation. */
class DelayLine {
  private readonly buf: Float32Array;
  private readonly mask: number;
  private w = 0;
  constructor(maxDelay: number) {
    let n = 2;
    while (n < maxDelay + 4) n <<= 1;
    this.buf = new Float32Array(n);
    this.mask = n - 1;
  }
  write(x: number) {
    this.buf[this.w] = x;
    this.w = (this.w + 1) & this.mask;
  }
  /** Sample written `d` samples before the last write (d ≥ 0, fractional). */
  read(d: number) {
    const p = this.w - 1 - d;
    const i = Math.floor(p);
    const f = p - i;
    const a = this.buf[i & this.mask];
    return a + (this.buf[(i + 1) & this.mask] - a) * f;
  }
}

/**
 * Granular pitch shifter: two read heads sweep through a delay line at `ratio` speed, half a grain
 * apart, each faded in and out with a Hann window (the two windows always sum to 1). At ratio 1 it
 * is a plain delay of half a grain, which is also its latency at any ratio.
 */
export class PitchShifter {
  private readonly lines: DelayLine[];
  private readonly size: number;
  private phase = 0;
  constructor(rate: number, channels: number) {
    this.size = Math.round(GRAIN * rate);
    this.lines = Array.from({ length: channels }, () => new DelayLine(this.size + 2));
  }
  /** Shift `n` samples from `from` in place. */
  process(ch: Float32Array[], from: number, n: number, ratio: number) {
    const r = Math.min(RATIO_RANGE[1], Math.max(RATIO_RANGE[0], ratio));
    const size = this.size;
    if (Math.abs(r - 1) < 1e-6) {
      // Same as phase 0: head 2 alone, half a grain behind.
      this.phase = 0;
      for (let c = 0; c < ch.length; c++) {
        const line = this.lines[c];
        const x = ch[c];
        for (let i = from; i < from + n; i++) {
          line.write(x[i]);
          x[i] = line.read(size / 2);
        }
      }
      return;
    }
    const step = (1 - r) / size;
    const start = this.phase;
    let p = start;
    for (let c = 0; c < ch.length; c++) {
      const line = this.lines[c];
      const x = ch[c];
      p = start;
      for (let i = from; i < from + n; i++) {
        line.write(x[i]);
        const q = p + 0.5 >= 1 ? p - 0.5 : p + 0.5;
        const g = 0.5 - 0.5 * Math.cos(2 * Math.PI * p);
        x[i] = line.read(p * size) * g + line.read(q * size) * (1 - g);
        p += step;
        if (p >= 1) p -= 1;
        else if (p < 0) p += 1;
      }
    }
    this.phase = p;
  }
}

/** RBJ cookbook biquad, transposed direct form II. */
export class Biquad {
  private b0 = 1;
  private b1 = 0;
  private b2 = 0;
  private a1 = 0;
  private a2 = 0;
  private z1 = 0;
  private z2 = 0;

  static lowpass = (rate: number, f: number, q = Math.SQRT1_2) => new Biquad().set('lowpass', rate, f, q, 0);
  static highpass = (rate: number, f: number, q = Math.SQRT1_2) => new Biquad().set('highpass', rate, f, q, 0);
  static bandpass = (rate: number, f: number, q: number) => new Biquad().set('bandpass', rate, f, q, 0);
  static peak = (rate: number, f: number, gain: number, q: number) => new Biquad().set('peak', rate, f, q, gain);
  static highShelf = (rate: number, f: number, gain: number) => new Biquad().set('highShelf', rate, f, Math.SQRT1_2, gain);

  private set(type: 'lowpass' | 'highpass' | 'bandpass' | 'peak' | 'highShelf', rate: number, f: number, q: number, gainDb: number) {
    const w = (2 * Math.PI * Math.min(f, rate * 0.45)) / rate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const A = 10 ** (gainDb / 40);
    let b0, b1, b2, a0, a1, a2;
    switch (type) {
      case 'lowpass':
        [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
        [a0, a1, a2] = [1 + alpha, -2 * cos, 1 - alpha];
        break;
      case 'highpass':
        [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
        [a0, a1, a2] = [1 + alpha, -2 * cos, 1 - alpha];
        break;
      case 'bandpass':
        [b0, b1, b2] = [alpha, 0, -alpha];
        [a0, a1, a2] = [1 + alpha, -2 * cos, 1 - alpha];
        break;
      case 'peak':
        [b0, b1, b2] = [1 + alpha * A, -2 * cos, 1 - alpha * A];
        [a0, a1, a2] = [1 + alpha / A, -2 * cos, 1 - alpha / A];
        break;
      case 'highShelf': {
        const s = 2 * Math.sqrt(A) * alpha;
        [b0, b1, b2] = [A * (A + 1 + (A - 1) * cos + s), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - s)];
        [a0, a1, a2] = [A + 1 - (A - 1) * cos + s, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - s];
        break;
      }
    }
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
    return this;
  }

  tick(x: number) {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

/** Deterministic noise (export renders the same file every time). */
function noise(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2147483648 - 1;
  };
}

/** The non-pitch part of a voice preset (filters, robot, drive…), one per channel. */
class Character {
  private readonly filters: Biquad[] = [];
  private readonly comb?: DelayLine;
  private readonly wobble?: DelayLine;
  private readonly rnd: () => number;
  private readonly drive: number;
  private readonly norm: number;
  constructor(
    private readonly r: VoiceRecipe,
    private readonly rate: number,
    channel: number,
  ) {
    if (r.lowCut) this.filters.push(Biquad.highpass(rate, r.lowCut), Biquad.highpass(rate, r.lowCut));
    if (r.highCut) this.filters.push(Biquad.lowpass(rate, r.highCut), Biquad.lowpass(rate, r.highCut));
    if (r.peak) this.filters.push(Biquad.peak(rate, r.peak[0], r.peak[1], r.peak[2]));
    if (r.shelf) this.filters.push(Biquad.highShelf(rate, r.shelf[0], r.shelf[1]));
    if (r.comb) this.comb = new DelayLine(Math.ceil(r.comb[0] * rate));
    if (r.vibrato) this.wobble = new DelayLine(Math.ceil(r.vibrato[1] * 2 * rate) + 2);
    this.rnd = noise(0x9e3779b9 + channel);
    this.drive = r.drive ?? 0;
    this.norm = this.drive ? 1 / Math.tanh(this.drive) : 1;
  }

  /** One sample; `n` = samples since the chain started (oscillator time). */
  tick(x: number, n: number) {
    const { r, rate } = this;
    if (r.ring) x *= 1 - r.ring[1] + r.ring[1] * Math.sin((2 * Math.PI * r.ring[0] * n) / rate);
    if (this.comb) {
      const y = x + this.comb.read(r.comb![0] * rate - 1) * r.comb![1];
      this.comb.write(y);
      x = y * (1 - r.comb![1]);
    }
    if (this.wobble) {
      const [hz, depth] = r.vibrato!;
      this.wobble.write(x);
      x = this.wobble.read(depth * rate * (1 + Math.sin((2 * Math.PI * hz * n) / rate)));
    }
    if (r.hiss) x += this.rnd() * r.hiss;
    for (const f of this.filters) x = f.tick(x);
    if (this.drive) x = Math.tanh(x * this.drive) * this.norm;
    return x;
  }
}

/**
 * Runs `fn` over fixed sub-blocks counted from the first sample ever processed, with the timeline
 * time of each sub-block's start, counted from the first call's `t0` (so slicing cannot change it).
 */
class Blocker {
  /** Samples processed so far. */
  pos = 0;
  private origin: number | undefined;
  constructor(private readonly rate: number) {}
  run(n: number, t0: number, fn: (from: number, len: number, t: number) => void) {
    this.origin ??= t0;
    let i = 0;
    while (i < n) {
      const len = Math.min(n - i, BLOCK - (this.pos % BLOCK));
      fn(i, len, this.origin + (this.pos - (this.pos % BLOCK)) / this.rate);
      i += len;
      this.pos += len;
    }
  }
}

/**
 * The voice stage of a clip: pitch shift (speed compensation included), then the preset's
 * character mixed in by `amount`. Delays the audio by `voiceLatency(rate)`.
 */
export class VoiceChain {
  private readonly shifter: PitchShifter;
  private readonly chars?: Character[];
  private readonly blocks: Blocker;
  constructor(
    kind: VoiceKind | undefined,
    rate: number,
    private readonly params: (t: number) => VoiceParams,
  ) {
    this.blocks = new Blocker(rate);
    this.shifter = new PitchShifter(rate, 2);
    const recipe = kind && VOICE_PRESETS[kind];
    if (recipe?.character) this.chars = [0, 1].map((c) => new Character(recipe, rate, c));
  }

  /** Process `n` stereo samples in place; `t0` = timeline time of ch[*][0]. */
  process(ch: Stereo, n: number, t0: number) {
    this.blocks.run(n, t0, (from, len, t) => {
      const p = this.params(t);
      this.shifter.process(ch, from, len, p.ratio);
      const chars = this.chars;
      if (!chars) return;
      const a = Math.max(0, Math.min(1, p.amount));
      for (let c = 0; c < 2; c++) {
        const x = ch[c];
        const chr = chars[c];
        for (let i = from, k = this.blocks.pos; i < from + len; i++, k++) {
          const dry = x[i];
          x[i] = dry + (chr.tick(dry, k) - dry) * a;
        }
      }
    });
  }
}

/** Feedback echo with a darkening loop filter. */
class Echo {
  private readonly line: DelayLine;
  private readonly lp: Biquad;
  constructor(
    rate: number,
    private readonly delay: number,
    private readonly feedback: number,
    highCut: number,
  ) {
    this.line = new DelayLine(Math.ceil(delay) + 2);
    this.lp = Biquad.lowpass(rate, highCut);
  }
  tick(x: number) {
    const y = this.line.read(this.delay - 1);
    this.line.write(x + this.lp.tick(y) * this.feedback);
    return y;
  }
}

/** Freeverb (Jezar's public-domain reverb): 8 parallel damped combs into 4 allpasses. */
class Freeverb {
  private static readonly COMBS = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
  private static readonly ALLPASSES = [556, 441, 341, 225];
  private readonly combs: { buf: Float32Array; i: number; store: number }[];
  private readonly passes: { buf: Float32Array; i: number }[];
  constructor(
    rate: number,
    spread: number,
    private readonly feedback: number,
    private readonly damp: number,
  ) {
    const scale = rate / 44100;
    this.combs = Freeverb.COMBS.map((n) => ({ buf: new Float32Array(Math.round((n + spread) * scale)), i: 0, store: 0 }));
    this.passes = Freeverb.ALLPASSES.map((n) => ({ buf: new Float32Array(Math.round((n + spread) * scale)), i: 0 }));
  }
  tick(x: number) {
    const input = x * 0.015;
    let out = 0;
    for (const c of this.combs) {
      const y = c.buf[c.i];
      c.store = y * (1 - this.damp) + c.store * this.damp;
      c.buf[c.i] = input + c.store * this.feedback;
      if (++c.i >= c.buf.length) c.i = 0;
      out += y;
    }
    for (const a of this.passes) {
      const b = a.buf[a.i];
      a.buf[a.i] = out + b * 0.5;
      if (++a.i >= a.buf.length) a.i = 0;
      out = b - out;
    }
    return out * 3;
  }
}

/** The space stage of a clip: dry signal plus echo/reverb at `mix`. Rings on after its input stops. */
export class SpaceChain {
  private readonly echoes: Echo[] = [];
  private readonly verbs: Freeverb[] = [];
  private readonly blocks: Blocker;
  constructor(
    fx: SpaceFx,
    rate: number,
    private readonly mixAt: (t: number) => number,
  ) {
    this.blocks = new Blocker(rate);
    const r = SPACE_PRESETS[fx.kind];
    const size = Math.max(0, Math.min(1, fx.size));
    for (let c = 0; c < 2; c++) {
      if (r.echo) this.echoes.push(new Echo(rate, (0.08 + size * 0.7) * rate, r.echo[0], r.echo[1]));
      if (r.early) this.echoes.push(new Echo(rate, r.early[0] * rate * (c ? 1.07 : 1), r.early[1], 2500));
      if (r.reverb !== undefined) this.verbs.push(new Freeverb(rate, c * 23, 0.7 + size * 0.28, r.reverb * 0.4));
    }
  }

  process(ch: Stereo, n: number, t0: number) {
    const echo = this.echoes.length / 2;
    this.blocks.run(n, t0, (from, len, t) => {
      const mix = Math.max(0, Math.min(1, this.mixAt(t)));
      for (let c = 0; c < 2; c++) {
        const x = ch[c];
        const e = echo ? this.echoes[c] : undefined;
        const v = this.verbs[c];
        for (let i = from; i < from + len; i++) {
          const dry = x[i];
          let wet = 0;
          if (e) wet += e.tick(dry);
          if (v) wet += v.tick(e ? dry + wet * 0.5 : dry);
          x[i] = dry * (1 - 0.3 * mix) + wet * mix;
        }
      }
    });
  }
}
