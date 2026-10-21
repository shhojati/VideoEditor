// Audio cleanup, shared by the preview (the voice worklet) and export (the worker mix) like
// voiceDsp.ts: spectral noise reduction against a measured noise profile, a voice "enhance" chain
// (EQ + compressor), and loudness measurement (ITU-R BS.1770) for Normalize. No DOM, no Web Audio.
import type { Clip, ClipClean } from '../../model/types';
import { Biquad } from './voiceDsp';

type Stereo = [Float32Array, Float32Array];

// ---- FFT ----------------------------------------------------------------------------------------

/** In-place iterative radix-2 complex FFT of a fixed size. */
export class Fft {
  private readonly rev: Uint32Array;
  private readonly cos: Float64Array;
  private readonly sin: Float64Array;
  constructor(readonly size: number) {
    const bits = Math.log2(size);
    this.rev = new Uint32Array(size);
    for (let i = 0; i < size; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(size / 2);
    this.sin = new Float64Array(size / 2);
    for (let i = 0; i < size / 2; i++) {
      this.cos[i] = Math.cos((2 * Math.PI * i) / size);
      this.sin[i] = -Math.sin((2 * Math.PI * i) / size);
    }
  }

  /** Forward transform (inverse: conjugate in and out, divide by size). */
  transform(re: Float64Array, im: Float64Array, inverse = false) {
    const n = this.size;
    for (let i = 0; i < n; i++) {
      const j = this.rev[i];
      if (j > i) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    const sign = inverse ? -1 : 1;
    for (let len = 2; len <= n; len <<= 1) {
      const half = len >> 1;
      const step = n / len;
      for (let i = 0; i < n; i += len) {
        for (let j = 0; j < half; j++) {
          const wr = this.cos[j * step];
          const wi = sign * this.sin[j * step];
          const a = i + j;
          const b = a + half;
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr;
          im[b] = im[a] - xi;
          re[a] += xr;
          im[a] += xi;
        }
      }
    }
    if (inverse) {
      for (let i = 0; i < n; i++) {
        re[i] /= n;
        im[i] /= n;
      }
    }
  }
}

// ---- noise profile ------------------------------------------------------------------------------

const FRAME = 1024;
const HOP = FRAME / 2;
/** Noise power spectral density on a fixed grid, 0..PROFILE_MAX_HZ, so it works at any sample rate. */
export const PROFILE_SIZE = 513;
const PROFILE_MAX_HZ = 24_000;
export type NoiseProfile = Float32Array;

const hann = (n: number) => Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n));

/** Profile value (noise power density) at a frequency. */
function profileAt(profile: NoiseProfile, hz: number) {
  const x = Math.min(PROFILE_SIZE - 1, Math.max(0, (hz / PROFILE_MAX_HZ) * (PROFILE_SIZE - 1)));
  const i = Math.floor(x);
  const f = x - i;
  return profile[i] + ((profile[Math.min(PROFILE_SIZE - 1, i + 1)] ?? 0) - profile[i]) * f;
}

/**
 * The recording's background noise: the average spectrum of its quietest frames (the quietest
 * 15%, digital silence ignored). Power is normalised by the window energy, so it does not depend
 * on the frame size or window.
 */
export function measureNoiseProfile(mono: Float32Array, rate: number): NoiseProfile {
  const fft = new Fft(FRAME);
  const win = hann(FRAME);
  const winPower = win.reduce((s, w) => s + w * w, 0);
  const spectra: Float32Array[] = [];
  const energy: number[] = [];
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  for (let start = 0; start + FRAME <= mono.length; start += HOP) {
    let e = 0;
    for (let i = 0; i < FRAME; i++) {
      re[i] = mono[start + i] * win[i];
      im[i] = 0;
      e += mono[start + i] * mono[start + i];
    }
    if (e < 1e-10) continue;
    fft.transform(re, im);
    const p = new Float32Array(FRAME / 2 + 1);
    for (let b = 0; b <= FRAME / 2; b++) p[b] = (re[b] * re[b] + im[b] * im[b]) / winPower;
    spectra.push(p);
    energy.push(e);
  }
  const profile = new Float32Array(PROFILE_SIZE);
  if (!spectra.length) return profile;
  const cut = [...energy].sort((a, b) => a - b)[Math.floor((energy.length - 1) * 0.15)];
  const quiet = spectra.filter((_, i) => energy[i] <= cut);
  const avg = new Float32Array(FRAME / 2 + 1);
  for (const p of quiet) for (let b = 0; b < avg.length; b++) avg[b] += p[b] / quiet.length;
  for (let i = 0; i < PROFILE_SIZE; i++) {
    const bin = Math.min(FRAME / 2, ((i / (PROFILE_SIZE - 1)) * PROFILE_MAX_HZ * FRAME) / rate);
    const k = Math.floor(bin);
    const f = bin - k;
    profile[i] = avg[k] + ((avg[Math.min(FRAME / 2, k + 1)] ?? 0) - avg[k]) * f;
  }
  return profile;
}

// ---- noise reduction ------------------------------------------------------------------------------

/**
 * Spectral gate: short-time FFT (1024-sample frames, 50% overlap, sqrt-Hann in and out), each bin
 * turned down where its power is close to the noise profile, with gains smoothed over time against
 * "musical noise". Both channels share the gains so the stereo image stays put. Delays the audio by
 * FRAME samples.
 */
export class Denoiser {
  static readonly latency = FRAME;
  private readonly fft = new Fft(FRAME);
  private readonly win = Float64Array.from(hann(FRAME), Math.sqrt);
  private readonly winPower = FRAME / 2;
  private readonly noise: Float64Array;
  private readonly gains = new Float64Array(FRAME / 2 + 1).fill(1);
  private readonly over: number;
  private readonly floor: number;
  private readonly history: Stereo = [new Float32Array(FRAME), new Float32Array(FRAME)];
  private readonly acc: Stereo = [new Float32Array(FRAME), new Float32Array(FRAME)];
  private readonly ready: Stereo = [new Float32Array(HOP), new Float32Array(HOP)];
  private readonly re: Float64Array[] = [new Float64Array(FRAME), new Float64Array(FRAME)];
  private readonly im: Float64Array[] = [new Float64Array(FRAME), new Float64Array(FRAME)];
  private fill = 0;

  constructor(profile: NoiseProfile, rate: number, strength: number) {
    this.noise = Float64Array.from({ length: FRAME / 2 + 1 }, (_, b) => profileAt(profile, (b * rate) / FRAME));
    const s = Math.max(0, Math.min(1, strength));
    this.over = 1 + 3 * s;
    this.floor = 10 ** (-(6 + 24 * s) / 20);
  }

  process(ch: Stereo, n: number) {
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < 2; c++) {
        this.history[c][HOP + this.fill] = ch[c][i];
        ch[c][i] = this.ready[c][this.fill];
      }
      if (++this.fill === HOP) {
        this.fill = 0;
        this.frame();
      }
    }
  }

  private frame() {
    const { re, im, win, fft } = this;
    for (let c = 0; c < 2; c++) {
      for (let i = 0; i < FRAME; i++) {
        re[c][i] = this.history[c][i] * win[i];
        im[c][i] = 0;
      }
      fft.transform(re[c], im[c]);
    }
    for (let b = 0; b <= FRAME / 2; b++) {
      const p = (re[0][b] ** 2 + im[0][b] ** 2 + re[1][b] ** 2 + im[1][b] ** 2) / (2 * this.winPower);
      const target = Math.max(this.floor, Math.min(1, 1 - (this.over * this.noise[b]) / Math.max(p, 1e-20)));
      // Open at once, close gently: fewer isolated bins flickering on and off.
      const g = target >= this.gains[b] ? target : this.gains[b] * 0.6 + target * 0.4;
      this.gains[b] = g;
      for (let c = 0; c < 2; c++) {
        re[c][b] *= g;
        im[c][b] *= g;
        if (b > 0 && b < FRAME / 2) {
          re[c][FRAME - b] = re[c][b];
          im[c][FRAME - b] = -im[c][b];
        }
      }
    }
    for (let c = 0; c < 2; c++) {
      fft.transform(re[c], im[c], true);
      const acc = this.acc[c];
      for (let i = 0; i < FRAME; i++) acc[i] += re[c][i] * win[i];
      this.ready[c].set(acc.subarray(0, HOP));
      acc.copyWithin(0, HOP);
      acc.fill(0, FRAME - HOP);
      this.history[c].copyWithin(0, HOP);
    }
  }
}

// ---- enhance ------------------------------------------------------------------------------------

/** Feed-forward compressor on the louder channel; gains in dB. */
export class Compressor {
  private env = 0;
  private readonly att: number;
  private readonly rel: number;
  constructor(
    rate: number,
    private readonly threshold = -24,
    private readonly ratio = 3,
    private readonly makeup = 4,
    attack = 0.005,
    release = 0.15,
  ) {
    this.att = Math.exp(-1 / (attack * rate));
    this.rel = Math.exp(-1 / (release * rate));
  }
  process(ch: Stereo, n: number) {
    for (let i = 0; i < n; i++) {
      const x = Math.max(Math.abs(ch[0][i]), Math.abs(ch[1][i]));
      this.env = x > this.env ? this.att * this.env + (1 - this.att) * x : this.rel * this.env + (1 - this.rel) * x;
      const db = 20 * Math.log10(this.env + 1e-9);
      const reduce = db > this.threshold ? (db - this.threshold) * (1 - 1 / this.ratio) : 0;
      const g = 10 ** ((this.makeup - reduce) / 20);
      ch[0][i] *= g;
      ch[1][i] *= g;
    }
  }
}

/** Noise reduction strength used by Enhance voice when the slider is lower. */
const ENHANCE_DENOISE = 0.4;

export const hasCleanStage = (clip: Pick<Clip, 'audio'>) => !!(clip.audio.clean && (clip.audio.clean.denoise > 0 || clip.audio.clean.enhance));

/** Noise reduction strength a clip asks for (0 = none). */
export const denoiseStrength = (clean: ClipClean | undefined) =>
  clean ? Math.max(clean.denoise, clean.enhance ? ENHANCE_DENOISE : 0) : 0;

/** Delay (samples) a clip's cleanup stage adds: noise reduction runs only with a profile. */
export const cleanLatency = (clean: ClipClean, profile: NoiseProfile | undefined) =>
  profile && denoiseStrength(clean) > 0 ? Denoiser.latency : 0;

/**
 * A clip's cleanup stage: noise reduction (needs the asset's noise profile; skipped without one),
 * then for Enhance voice a rumble cut, a little less mud, more presence, and gentle compression.
 * Runs before the voice effects. `latency` samples of delay.
 */
export class CleanChain {
  readonly latency: number;
  private readonly denoiser?: Denoiser;
  private readonly eq?: Biquad[][];
  private readonly comp?: Compressor;
  constructor(clean: ClipClean, rate: number, profile: NoiseProfile | undefined) {
    this.latency = cleanLatency(clean, profile);
    if (this.latency) this.denoiser = new Denoiser(profile!, rate, denoiseStrength(clean));
    if (clean.enhance) {
      this.eq = [0, 1].map(() => [Biquad.highpass(rate, 80), Biquad.peak(rate, 250, -2, 1), Biquad.peak(rate, 3500, 3, 0.9)]);
      this.comp = new Compressor(rate);
    }
  }
  process(ch: Stereo, n: number) {
    this.denoiser?.process(ch, n);
    if (this.eq) {
      for (let c = 0; c < 2; c++) {
        const x = ch[c];
        const [a, b, d] = this.eq[c];
        for (let i = 0; i < n; i++) x[i] = d.tick(b.tick(a.tick(x[i])));
      }
      this.comp!.process(ch, n);
    }
  }
}

// ---- loudness -----------------------------------------------------------------------------------

/** Biquad from raw coefficients (BS.1770 K-weighting is given that way, at 48 kHz). */
class RawBiquad {
  private z1 = 0;
  private z2 = 0;
  constructor(
    private readonly b: [number, number, number],
    private readonly a: [number, number],
  ) {}
  tick(x: number) {
    const y = this.b[0] * x + this.z1;
    this.z1 = this.b[1] * x - this.a[0] * y + this.z2;
    this.z2 = this.b[2] * x - this.a[1] * y;
    return y;
  }
}

/** K-weighting filters (BS.1770-4 annex 1) for any sample rate, via the analog prototypes. */
function kWeighting(rate: number): RawBiquad[] {
  // Stage 1: high shelf (+4 dB above ~1.7 kHz).
  const f0 = 1681.974450955533;
  const G = 3.999843853973347;
  const Q = 0.7071752369554196;
  const K = Math.tan((Math.PI * f0) / rate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  const a0 = 1 + K / Q + K * K;
  const shelf = new RawBiquad(
    [(Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0],
    [(2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0],
  );
  // Stage 2: high pass (RLB weighting, ~38 Hz).
  const f1 = 38.13547087602444;
  const Q1 = 0.5003270373238773;
  const K1 = Math.tan((Math.PI * f1) / rate);
  const d = 1 + K1 / Q1 + K1 * K1;
  const hp = new RawBiquad([1, -2, 1], [(2 * (K1 * K1 - 1)) / d, (1 - K1 / Q1 + K1 * K1) / d]);
  return [shelf, hp];
}

/**
 * Integrated loudness (LUFS), BS.1770-4: K-weighting, 400 ms blocks with 75% overlap, absolute
 * gate at -70 LUFS and relative gate 10 LU below. Fed in pieces, so long clips need little memory.
 */
export class LoudnessMeter {
  private readonly filters: RawBiquad[][] = [];
  private readonly step: number;
  /** Weighted energy per completed 100 ms step (all channels summed, weight 1 each). */
  private readonly steps: number[] = [];
  private cur = 0;
  private pos = 0;
  constructor(private readonly rate: number) {
    this.step = Math.round(0.1 * rate);
  }

  /** Add planar samples (the same channel count every time). */
  push(channels: Float32Array[], n = channels[0]?.length ?? 0) {
    while (this.filters.length < channels.length) this.filters.push(kWeighting(this.rate));
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < channels.length; c++) {
        const [s1, s2] = this.filters[c];
        const y = s2.tick(s1.tick(channels[c][i]));
        this.cur += y * y;
      }
      if (++this.pos === this.step) {
        this.steps.push(this.cur);
        this.cur = 0;
        this.pos = 0;
      }
    }
  }

  /** -Infinity for silence or less than one block. */
  result(): number {
    const sq = this.steps;
    const block = 4 * this.step;
    const blocks: number[] = [];
    for (let i = 0; i + 4 <= sq.length; i++) blocks.push((sq[i] + sq[i + 1] + sq[i + 2] + sq[i + 3]) / block);
    return gatedLoudness(blocks);
  }
}

export function integratedLoudness(channels: Float32Array[], rate: number): number {
  const m = new LoudnessMeter(rate);
  m.push(channels);
  return m.result();
}

function gatedLoudness(blocks: number[]): number {
  const lufs = (z: number) => -0.691 + 10 * Math.log10(z);
  const mean = (list: number[]) => list.reduce((a, b) => a + b, 0) / list.length;
  const abs = blocks.filter((z) => lufs(z) > -70);
  if (!abs.length) return -Infinity;
  const rel = lufs(mean(abs)) - 10;
  const gated = abs.filter((z) => lufs(z) > rel);
  return lufs(mean(gated));
}

/** Normalize target (spoken word / online video) and the most the button will change. */
export const NORMALIZE_TARGET = -16;
const NORMALIZE_LIMIT = 20;

/** Gain (dB) that brings a clip measured at `lufs` to the target. */
export const normalizeGain = (lufs: number) =>
  Number.isFinite(lufs) ? Math.round(Math.max(-NORMALIZE_LIMIT, Math.min(NORMALIZE_LIMIT, NORMALIZE_TARGET - lufs)) * 10) / 10 : 0;
