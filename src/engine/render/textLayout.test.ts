import { describe, expect, it } from 'vitest';
import { balanceLines, detectRtl, wrapLines } from './textLayout';

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
    // "می\u200Cخواهم" contains U+200C (ZWNJ) and must stay one word.
    expect(wrapLines('من می\u200Cخواهم بروم', 90, measure)).toEqual(['من', 'می\u200Cخواهم', 'بروم']);
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

describe('balanceLines', () => {
  it('keeps short text on one line', () => {
    expect(balanceLines('a bb', 100, measure)).toEqual(['a bb']);
  });
  it('splits into two even lines rather than greedily', () => {
    // greedy at 120 would give ['aaa bbb ccc', 'dd']
    expect(balanceLines('aaa bbb ccc dd', 120, measure)).toEqual(['aaa bbb', 'ccc dd']);
  });
  it('falls back to greedy wrapping when two lines are not enough', () => {
    expect(balanceLines('aaaa bbbb cccc dddd', 45, measure)).toEqual(['aaaa', 'bbbb', 'cccc', 'dddd']);
  });
  it('respects explicit line breaks', () => {
    expect(balanceLines('a b\nc', 1000, measure)).toEqual(['a b', 'c']);
  });
});
