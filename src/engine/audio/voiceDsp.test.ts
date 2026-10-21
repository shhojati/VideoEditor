import { describe, expect, it } from 'vitest';
import { Biquad, PitchShifter, SpaceChain, VoiceChain, voiceLatency } from './voiceDsp';

const RATE = 48000;
const sine = (hz: number, seconds: number) => Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / RATE));

/** Frequency from upward zero crossings over [from, to) seconds. */
function frequency(x: Float32Array, from: number, to: number) {
  let n = 0;
  for (let i = Math.round(from * RATE) + 1; i < Math.round(to * RATE); i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
  return n / (to - from);
}

const rms = (x: Float32Array, from = 0, to = x.length) => {
  let s = 0;
  for (let i = from; i < to; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, to - from));
};

function shift(x: Float32Array, ratio: number) {
  const ch = [Float32Array.from(x)];
  new PitchShifter(RATE, 1).process(ch, 0, x.length, ratio);
  return ch[0];
}

describe('PitchShifter', () => {
  it('an octave up doubles the frequency and keeps the length', () => {
    const y = shift(sine(440, 1), 2);
    expect(y.length).toBe(RATE);
    expect(frequency(y, 0.2, 1)).toBeGreaterThan(880 * 0.97);
    expect(frequency(y, 0.2, 1)).toBeLessThan(880 * 1.03);
  });

  it('an octave down halves it', () => {
    const y = shift(sine(440, 1), 0.5);
    expect(frequency(y, 0.2, 1)).toBeGreaterThan(220 * 0.97);
    expect(frequency(y, 0.2, 1)).toBeLessThan(220 * 1.03);
  });

  it('ratio 1 is a plain delay of its latency', () => {
    const x = sine(300, 0.2);
    const y = shift(x, 1);
    const lat = voiceLatency(RATE);
    for (let i = lat; i < x.length; i += 97) expect(y[i]).toBeCloseTo(x[i - lat], 6);
  });
});

describe('Biquad', () => {
  it('a telephone band keeps 1 kHz and cuts 100 Hz and 8 kHz', () => {
    const band = (x: Float32Array) => {
      const hp = Biquad.highpass(RATE, 300);
      const lp = Biquad.lowpass(RATE, 3400);
      return x.map((v) => lp.tick(hp.tick(v)));
    };
    const level = (hz: number) => rms(band(sine(hz, 0.5)), RATE / 10);
    expect(level(1000)).toBeGreaterThan(0.3);
    expect(level(100)).toBeLessThan(0.1);
    expect(level(8000)).toBeLessThan(0.1);
  });
});

describe('VoiceChain', () => {
  it('gives the same output however the audio is sliced', () => {
    const x = sine(220, 0.5).map((v, i) => v + 0.1 * Math.sin(i * 0.37));
    const params = (t: number) => ({ ratio: 1.2 + 0.3 * Math.sin(t * 7), amount: 0.8 });
    const run = (block: number) => {
      const chain = new VoiceChain('robot', RATE, params);
      const ch: [Float32Array, Float32Array] = [Float32Array.from(x), Float32Array.from(x)];
      for (let i = 0; i < x.length; i += block) {
        const n = Math.min(block, x.length - i);
        const part: [Float32Array, Float32Array] = [ch[0].subarray(i), ch[1].subarray(i)];
        chain.process(part, n, i / RATE);
      }
      return ch;
    };
    const a = run(128);
    const b = run(4800);
    expect(b[0]).toEqual(a[0]);
    expect(b[1]).toEqual(a[1]);
  });

  it('every preset stays finite and bounded', () => {
    for (const kind of ['monster', 'robot', 'alien', 'underwater', 'telephone', 'radio', 'megaphone', 'walkie'] as const) {
      const chain = new VoiceChain(kind, RATE, () => ({ ratio: 1, amount: 1 }));
      const ch: [Float32Array, Float32Array] = [sine(200, 0.3), sine(200, 0.3)];
      chain.process(ch, ch[0].length, 0);
      for (const v of ch[0]) expect(Math.abs(v)).toBeLessThan(2);
      expect(rms(ch[0])).toBeGreaterThan(0.01);
    }
  });
});

describe('SpaceChain', () => {
  const impulse = (seconds: number): [Float32Array, Float32Array] => {
    const ch: [Float32Array, Float32Array] = [new Float32Array(seconds * RATE), new Float32Array(seconds * RATE)];
    ch[0][0] = ch[1][0] = 1;
    return ch;
  };

  it('echo repeats at its delay time', () => {
    const ch = impulse(2);
    new SpaceChain({ kind: 'echo', mix: 1, size: 0.4 }, RATE, () => 1).process(ch, ch[0].length, 0);
    const tap = Math.round((0.08 + 0.4 * 0.7) * RATE);
    expect(ch[0][tap]).toBeGreaterThan(0.5);
    expect(Math.abs(ch[0][tap - 10])).toBeLessThan(1e-6);
    expect(Math.max(...ch[0].subarray(2 * tap - 50, 2 * tap + 50))).toBeGreaterThan(0.05);
  });

  it('reverb rings and dies away', () => {
    const ch = impulse(3);
    new SpaceChain({ kind: 'hall', mix: 1, size: 0.75 }, RATE, () => 1).process(ch, ch[0].length, 0);
    expect(ch[0].every(Number.isFinite)).toBe(true);
    const early = rms(ch[0], RATE / 20, RATE / 2);
    const late = rms(ch[0], 2.5 * RATE, 3 * RATE);
    expect(early).toBeGreaterThan(0.001);
    expect(late).toBeLessThan(early / 5);
  });
});
