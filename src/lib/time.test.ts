import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration } from './time';

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
