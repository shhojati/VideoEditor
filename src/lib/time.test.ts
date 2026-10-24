import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, parseTimecode } from './time';

describe('formatDuration', () => {
  it.each([
    [0, '0:00'],
    [5.4, '0:05'],
    [59.6, '1:00'],
    [125, '2:05'],
    [3600, '1:00:00'],
    [3725, '1:02:05'],
    [-3, '0:00'],
    [NaN, '0:00'],
  ])('%s -> %s', (s, out) => expect(formatDuration(s)).toBe(out));
});

describe('formatBytes', () => {
  it.each([
    [500, '500 B'],
    [1536, '1.5 KB'],
    [250 * 1024 * 1024, '250 MB'],
    [3.2 * 1024 ** 3, '3.2 GB'],
  ])('%s -> %s', (b, out) => expect(formatBytes(b)).toBe(out));
});

describe('parseTimecode', () => {
  it.each([
    ['12.5', 12.5],
    ['1:05', 65],
    ['1:02:03', 3723],
    ['00:00:01:15', 1.5],
    ['۱:۳۰', 90],
    [' 2,5 ', 2.5],
    ['', null],
    ['abc', null],
    ['1::2', null],
    ['1:2:3:4:5', null],
  ])('%s -> %s', (text, out) => expect(parseTimecode(text, 30)).toBe(out));
});
