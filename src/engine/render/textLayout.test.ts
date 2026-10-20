import { describe, expect, it } from 'vitest';
import { detectRtl, wrapLines } from './textLayout';

const measure = (s: string) => s.length * 10;

describe('wrapLines', () => {
  it('wraps greedily at spaces', () => {
    expect(wrapLines('aaa bbb ccc ddd', 75, measure)).toEqual(['aaa bbb', 'ccc ddd']);
  });

  it('keeps explicit line breaks and empty lines', () => {
    expect(wrapLines('one\n\ntwo', 1000, measure)).toEqual(['one', '', 'two']);
  });

  it('never splits a word, even one wider than the line', () => {
    expect(wrapLines('supercalifragilistic is long', 50, measure)).toEqual(['supercalifragilistic', 'is', 'long']);
  });

  it('keeps ZWNJ-joined Persian words together', () => {
    // "می‌خواهم" contains U+200C (ZWNJ) and must stay one word.
    expect(wrapLines('من می‌خواهم بروم', 90, measure)).toEqual(['من', 'می‌خواهم', 'بروم']);
  });

  it('collapses repeated spaces', () => {
    expect(wrapLines('a   b', 1000, measure)).toEqual(['a b']);
  });
});

describe('detectRtl', () => {
  it.each([
    ['سلام دنیا', true],
    ['Hello', false],
    ['2024 سال', true],
    ['React در ایران', false],
    ['«نقل قول»', true],
    ['123', false],
  ])('%s -> %s', (s, rtl) => expect(detectRtl(s)).toBe(rtl));
});
