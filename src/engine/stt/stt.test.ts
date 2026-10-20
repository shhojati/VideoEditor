import { describe, expect, it } from 'vitest';
import { BinAccumulator } from './audio16k';
import { collapseRepeats, segmentsToCues } from './postprocess';
import { planWindows } from './windows';

describe('BinAccumulator', () => {
  it('averages 48 kHz stereo down to 16 kHz mono and mixes with gain', () => {
    const acc = new BinAccumulator(0, 2);
    // 6 input frames at 3 per output bin; L/R averaged.
    acc.push([Float32Array.of(1, 1, 1, 0, 0, 0), Float32Array.of(0, 0, 0, 0, 0, 1)], (i) => i / 3);
    const mix = new Float32Array(2);
    acc.addInto(mix, 2);
    expect(mix[0]).toBe(1);
    expect(mix[1]).toBeCloseTo(1 / 3);
  });

  it('places a clip at its timeline offset and ignores samples outside it', () => {
    const acc = new BinAccumulator(5, 1);
    acc.push([Float32Array.of(0.5, 0.5)], (i) => 5 + i * 10);
    const mix = new Float32Array(8);
    acc.addInto(mix, 1);
    expect(mix[5]).toBe(0.5);
    expect(mix.reduce((a, b) => a + b)).toBe(0.5);
  });
});

describe('planWindows', () => {
  const rate = 1000;
  /** Loud everywhere except quiet gaps at the given seconds. */
  function signal(seconds: number, quiet: [number, number][]) {
    const pcm = new Float32Array(seconds * rate).fill(0.2);
    for (const [a, b] of quiet) pcm.fill(0, a * rate, b * rate);
    return pcm;
  }

  it('cuts in the middle of the quiet moment before the limit', () => {
    const w = planWindows(signal(70, [[25, 25.5], [52, 52.4]]), rate);
    const cuts = w.map((x) => x.end / rate);
    expect(w[0].start).toBe(0);
    expect(cuts[0]).toBeCloseTo(25.25, 1);
    expect(cuts[1]).toBeCloseTo(52.2, 1);
    expect(cuts[2]).toBe(70);
    expect(w[1].start).toBe(w[0].end);
  });

  it('cuts exactly at the limit when there is no quiet spot, and skips silent windows', () => {
    const pcm = signal(90, [[30, 90]]);
    const w = planWindows(pcm, rate);
    expect(w).toEqual([{ start: 0, end: 28_000 }, { start: 28_000, end: 56_000 }]);
  });
});

describe('collapseRepeats', () => {
  it('collapses word and phrase loops beyond three repetitions', () => {
    expect(collapseRepeats('از از از از از از خانه')).toEqual({ text: 'از از از خانه', collapsed: true });
    expect(collapseRepeats('این اون این اون این اون این اون تمام')).toEqual({ text: 'این اون این اون این اون تمام', collapsed: true });
    expect(collapseRepeats('نه نه نه')).toEqual({ text: 'نه نه نه', collapsed: false });
  });
});

describe('segmentsToCues', () => {
  it('splits long segments by length and duration, sharing time by text length', () => {
    const text = Array.from({ length: 30 }, (_, i) => `واژه${i}`).join(' '); // ~200 chars
    const cues = segmentsToCues([{ start: 10, end: 20, text }]);
    expect(cues.length).toBeGreaterThanOrEqual(3);
    expect(cues[0].start).toBe(10);
    expect(cues.at(-1)!.end).toBe(20);
    expect(cues.every((c) => c.text.length <= 84 && c.end - c.start <= 7)).toBe(true);
    expect(cues.map((c) => c.text).join(' ')).toBe(text);
  });

  it('flags doubtful cues, drops empty ones and fixes overlaps', () => {
    const cues = segmentsToCues([
      { start: 0, end: 2, text: ' سلام دوستان ' },
      { start: 1.9, end: 2.2, text: 'آه' },
      { start: 3, end: 5, text: '   ' },
      { start: 5, end: 8, text: 'از از از از از از' },
    ]);
    expect(cues.map((c) => [c.text, c.review])).toEqual([
      ['سلام دوستان', false],
      ['آه', true],
      ['از از از', true],
    ]);
    expect(cues[0].end).toBe(1.9);
  });
});
