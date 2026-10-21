import { describe, expect, it } from 'vitest';
import { detectBeats } from './beats';

const RATE = 48_000;

/** Decaying noise bursts ("kicks") at the given times, with a quiet bed of noise under them. */
function clicks(seconds: number, times: number[], seed = 3) {
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x7fffffff) * 2 - 1;
  };
  const x = Float32Array.from({ length: seconds * RATE }, () => rnd() * 0.01);
  for (const t of times) {
    const at = Math.round(t * RATE);
    for (let i = 0; i < RATE * 0.08 && at + i < x.length; i++) x[at + i] += rnd() * 0.8 * Math.exp(-i / (RATE * 0.015));
  }
  return x;
}

const grid = (bpm: number, seconds: number, offset = 0) =>
  Array.from({ length: Math.floor(((seconds - offset) * bpm) / 60) }, (_, i) => offset + (i * 60) / bpm);

describe('detectBeats', () => {
  it('finds 120 BPM and beats on the clicks', () => {
    const truth = grid(120, 12, 0.3);
    const { bpm, times } = detectBeats(clicks(12, truth), RATE);
    expect(bpm).toBeGreaterThan(119);
    expect(bpm).toBeLessThan(121);
    const inner = times.filter((t) => t > 1 && t < 11);
    for (let i = 1; i < inner.length; i++) expect(Math.abs(inner[i] - inner[i - 1] - 0.5)).toBeLessThan(0.012);
    // Every detected beat is within 15 ms of a click.
    for (const t of inner) expect(Math.min(...truth.map((c) => Math.abs(c - t)))).toBeLessThan(0.015);
  });

  it('follows 90 BPM', () => {
    const truth = grid(90, 14, 0.1);
    const { bpm, times } = detectBeats(clicks(14, truth), RATE);
    expect(Math.abs(bpm - 90)).toBeLessThan(1.5);
    expect(times.length).toBeGreaterThan(truth.length - 3);
  });

  it('gives nothing for silence', () => {
    expect(detectBeats(new Float32Array(RATE * 5), RATE)).toEqual({ bpm: 0, times: [] });
  });
});
