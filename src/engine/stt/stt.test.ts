import { describe, expect, it } from 'vitest';
import { BinAccumulator, describeMix, mixClip, STT_RATE, type AudioChunk } from './audio16k';
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

describe('mixClip', () => {
  const clip = { start: 1, duration: 1, inPoint: 2, speed: 1, gain: 1 };
  /** One second of 0.5 at 16 kHz starting at source time `at`. */
  const second = (at: number): AudioChunk => ({ channels: [new Float32Array(STT_RATE).fill(0.5)], timestamp: at, sampleRate: STT_RATE });

  it('reads only the clip range and places it on the timeline', async () => {
    const calls: unknown[][] = [];
    const mix = new Float32Array(3 * STT_RATE);
    const stats = await mixClip(mix, clip, async function* (...range) {
      calls.push(range);
      yield second(2);
    });
    expect(calls).toEqual([[2, 3]]);
    expect(mix[STT_RATE - 1]).toBe(0);
    expect(mix[STT_RATE]).toBe(0.5);
    expect(stats).toMatchObject({ frames: STT_RATE, used: STT_RATE, first: 2, peak: 0.5, sampleRate: STT_RATE, channels: 1 });
    expect(stats.retried).toBeUndefined();
  });

  it('reads the whole file when the ranged read gives nothing (some Android decoders)', async () => {
    const calls: unknown[][] = [];
    const mix = new Float32Array(3 * STT_RATE);
    const stats = await mixClip(mix, clip, async function* (...range) {
      calls.push(range);
      if (range.length) return;
      for (let t = 0; t < 4; t++) yield second(t);
    });
    expect(calls).toEqual([[2, 3], []]);
    expect(mix[STT_RATE]).toBe(0.5);
    expect(mix[0]).toBe(0);
    expect(stats).toMatchObject({ frames: 4 * STT_RATE, first: 0, last: 3, retried: true });
    // The clip spans one extra bin at its end, so a frame or two of the next second lands in it too.
    expect(stats.used).toBeGreaterThanOrEqual(STT_RATE);
  });
});

describe('describeMix', () => {
  it('summarises each clip on one line', () => {
    expect(describeMix([])).toBe('no audible clips');
    expect(describeMix([{ codec: 'aac', sampleRate: 48_000, channels: 2, frames: 96_000, used: 0, first: 0.0213, last: 1.98, peak: 0 }])).toBe(
      '1: aac 48000Hz 2ch, 0/96000 frames, ts 0.02..1.98s, peak 0',
    );
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

describe('segmentsToCues with word timings', () => {
  const w = (text: string, start: number, end: number) => ({ text, start, end });

  it('breaks at pauses and sentence ends and keeps each cue its words', () => {
    const words = [w('سلام', 0, 0.4), w('دوستان.', 0.5, 1), w('امروز', 1.1, 1.5), w('درباره', 1.6, 2), w('فیلم', 3.2, 3.6), w('حرف', 3.7, 4), w('می‌زنیم', 4.1, 4.6)];
    const cues = segmentsToCues([{ start: 0, end: 5, text: '', words }]);
    expect(cues.map((c) => c.text)).toEqual(['سلام دوستان.', 'امروز درباره', 'فیلم حرف می‌زنیم']);
    expect(cues.map((c) => [c.start, c.end])).toEqual([[0, 1], [1.1, 2], [3.2, 4.6]]);
    expect(cues[2].words).toEqual(words.slice(4));
  });

  it('collapses repeated words and drops empty ones', () => {
    const words = ['از', 'از', 'از', 'از', 'از', ' ', 'خانه'].map((t, i) => w(t, i * 0.2, i * 0.2 + 0.18));
    const [cue] = segmentsToCues([{ start: 0, end: 3, text: '', words }]);
    expect(cue.text).toBe('از از از خانه');
    expect(cue.words!.map((x) => x.text)).toEqual(['از', 'از', 'از', 'خانه']);
    expect(cue.review).toBe(true);
  });
});
