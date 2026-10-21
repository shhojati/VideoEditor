import { describe, expect, it } from 'vitest';
import { activeWordIndex, placeWords } from './subtitles';

// Monospace stand-in: every character is 10 px wide.
const measure = (s: string) => s.length * 10;
const timed = (texts: string[]) => texts.map((text, i) => ({ text, start: i }));

describe('placeWords', () => {
  it('lays LTR words out left to right around the centre', () => {
    const placed = placeWords(['ab cd'], timed(['ab', 'cd']), measure, false, 100, 50, 20);
    // Line is 50 px wide, from x=75: "ab" centre 85, "cd" starts after "ab " (30 px) → centre 115.
    expect(placed.map((p) => [p.text, p.x, p.y])).toEqual([['ab', 85, 50], ['cd', 115, 50]]);
  });

  it('lays RTL words out right to left and continues on the next line', () => {
    const placed = placeWords(['ab cd', 'efg'], timed(['ab', 'cd', 'efg']), measure, true, 100, 50, 20);
    expect(placed.map((p) => [p.text, p.x, p.y, p.start])).toEqual([
      ['ab', 115, 50, 0],
      ['cd', 85, 50, 1],
      ['efg', 100, 70, 2],
    ]);
  });
});

describe('activeWordIndex', () => {
  it('is the last word that has started, and stays lit through pauses', () => {
    const words = [{ start: 1 }, { start: 2 }, { start: 4 }];
    expect([0.5, 1, 2.5, 3.9, 4].map((t) => activeWordIndex(words, t))).toEqual([-1, 0, 1, 1, 2]);
  });
});
