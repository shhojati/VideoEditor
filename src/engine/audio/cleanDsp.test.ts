import { describe, expect, it } from 'vitest';
import { CleanChain, Compressor, Denoiser, Fft, integratedLoudness, LoudnessMeter, measureNoiseProfile, normalizeGain } from './cleanDsp';

const RATE = 48_000;
/** Deterministic white noise. */
function noise(n: number, amp: number, seed = 1) {
  let s = seed;
  return Float32Array.from({ length: n }, () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return ((s / 0x7fffffff) * 2 - 1) * amp;
  });
}
const sine = (n: number, hz: number, amp: number) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / RATE));
const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / (to - from));
};

describe('Fft', () => {
  it('finds a sine in its bin and inverts back', () => {
    const fft = new Fft(64);
    const re = Float64Array.from({ length: 64 }, (_, i) => Math.cos((2 * Math.PI * 5 * i) / 64));
    const im = new Float64Array(64);
    const orig = re.slice();
    fft.transform(re, im);
    expect(Math.hypot(re[5], im[5])).toBeCloseTo(32);
    expect(Math.hypot(re[6], im[6])).toBeLessThan(1e-9);
    fft.transform(re, im, true);
    orig.forEach((v, i) => expect(re[i]).toBeCloseTo(v));
  });
});

describe('Denoiser', () => {
  it('passes audio through unchanged (delayed) when there is no noise in the profile', () => {
    const d = new Denoiser(new Float32Array(513), RATE, 1);
    const x = sine(8192, 440, 0.5);
    const ch: [Float32Array, Float32Array] = [x.slice(), x.slice()];
    d.process(ch, x.length);
    for (let i = Denoiser.latency + 1024; i < 8192; i += 97) expect(ch[0][i]).toBeCloseTo(x[i - Denoiser.latency], 4);
  });

  it('removes steady noise and keeps the tone', () => {
    const n = RATE * 2;
    const hiss = noise(n, 0.05);
    const profile = measureNoiseProfile(hiss, RATE);
    // First second: noise alone; second: tone + noise.
    const tone = sine(n, 440, 0.3);
    const x = Float32Array.from(hiss, (v, i) => v + (i >= RATE ? tone[i] : 0));
    const ch: [Float32Array, Float32Array] = [x.slice(), x.slice()];
    const d = new Denoiser(profile, RATE, 1);
    d.process(ch, n);
    const L = Denoiser.latency;
    const noiseBefore = rms(x, RATE / 4, RATE - 4096);
    const noiseAfter = rms(ch[0], RATE / 4 + L, RATE - 4096 + L);
    expect(noiseAfter).toBeLessThan(noiseBefore * 0.15); // > 16 dB less hiss
    const toneAfter = rms(ch[0], RATE + 8192 + L, n);
    expect(toneAfter).toBeGreaterThan(rms(tone, RATE + 8192, n) * 0.85);
  });
});

describe('measureNoiseProfile', () => {
  it('uses the quiet frames and ignores digital silence', () => {
    const x = new Float32Array(RATE * 2);
    x.set(noise(RATE / 2, 0.01), RATE / 2);
    x.set(noise(RATE / 2, 0.5, 7), RATE);
    const p = measureNoiseProfile(x, RATE);
    // White noise of amplitude a (uniform): variance a²/3, spread over the spectrum.
    const loudProfile = measureNoiseProfile(noise(RATE, 0.5, 7), RATE);
    expect(p[100]).toBeLessThan(loudProfile[100] / 100);
    expect(p[100]).toBeGreaterThan(0);
  });
});

describe('Compressor', () => {
  it('turns loud parts down relative to quiet ones', () => {
    const c = new Compressor(RATE, -24, 4, 0);
    const quiet = sine(RATE, 200, 0.02);
    const loud = sine(RATE, 200, 0.8);
    const q: [Float32Array, Float32Array] = [quiet.slice(), quiet.slice()];
    const l: [Float32Array, Float32Array] = [loud.slice(), loud.slice()];
    c.process(q, RATE);
    new Compressor(RATE, -24, 4, 0).process(l, RATE);
    expect(rms(q[0], RATE / 2)).toBeCloseTo(rms(quiet, RATE / 2), 3);
    const ratioIn = rms(loud) / rms(quiet);
    const ratioOut = rms(l[0], RATE / 2) / rms(q[0], RATE / 2);
    expect(ratioOut).toBeLessThan(ratioIn / 4);
  });
});

describe('CleanChain', () => {
  it('has no delay without a profile and still enhances', () => {
    const chain = new CleanChain({ denoise: 0.5, enhance: true }, RATE, undefined);
    expect(chain.latency).toBe(0);
    const rumble = sine(RATE, 30, 0.5);
    const ch: [Float32Array, Float32Array] = [rumble.slice(), rumble.slice()];
    chain.process(ch, RATE);
    expect(rms(ch[0], RATE / 2)).toBeLessThan(0.1); // 30 Hz cut by the high-pass
    expect(new CleanChain({ denoise: 0.5 }, RATE, new Float32Array(513)).latency).toBe(Denoiser.latency);
  });
});

describe('loudness', () => {
  it('measures a 1 kHz sine per BS.1770 (0 dBFS on one channel = -3.01 LUFS)', () => {
    expect(integratedLoudness([sine(RATE * 3, 1000, 1)], RATE)).toBeCloseTo(-3.01, 1);
    expect(integratedLoudness([sine(RATE * 3, 1000, 0.1)], RATE)).toBeCloseTo(-23.01, 1);
    // Stereo: both channels count.
    const s = sine(RATE * 3, 1000, 0.1);
    expect(integratedLoudness([s, s], RATE)).toBeCloseTo(-20, 1);
  });

  it('gives the same result fed in pieces, gates silence, and works at 44.1 kHz', () => {
    const x = sine(RATE * 3, 1000, 0.1);
    const m = new LoudnessMeter(RATE);
    for (let i = 0; i < x.length; i += 1000) m.push([x.subarray(i, i + 1000)]);
    expect(m.result()).toBeCloseTo(integratedLoudness([x], RATE), 6);
    // A long silence after the tone is gated out (only the blocks straddling its end count: -0.2 LU).
    const padded = new Float32Array(RATE * 10);
    padded.set(x);
    expect(integratedLoudness([padded], RATE)).toBeGreaterThan(-23.4);
    expect(integratedLoudness([new Float32Array(RATE)], RATE)).toBe(-Infinity);
    const r = 44_100;
    const y = Float32Array.from({ length: r * 3 }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 1000 * i) / r));
    expect(integratedLoudness([y], r)).toBeCloseTo(-23.01, 1);
  });

  it('normalize gain reaches -16 LUFS within ±20 dB', () => {
    expect(normalizeGain(-23)).toBe(7);
    expect(normalizeGain(-50)).toBe(20);
    expect(normalizeGain(-6)).toBe(-10);
    expect(normalizeGain(-Infinity)).toBe(0);
  });
});
