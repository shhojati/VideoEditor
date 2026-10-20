import { describe, expect, it } from 'vitest';
import { PeakBuilder } from './peaks';

describe('PeakBuilder', () => {
  it('records min/max per bucket across chunk boundaries and channels', () => {
    // 1 s at 8 Hz, 2 buckets per second => 4 frames per bucket
    const b = new PeakBuilder(1, 2);
    expect(b.bucketCount).toBe(2);
    b.push([Float32Array.of(0.1, -0.5, 0.2), Float32Array.of(0, 0, 0.9)], 8, 0); // frames 0..2
    b.push([Float32Array.of(0.3, -0.2, 0.4), Float32Array.of(0, -1, 0)], 8, 3 / 8); // frames 3..5
    const p = b.result();
    // bucket 0 = frames 0..3, bucket 1 = frames 4..7
    expect(Array.from(p.slice(0, 2))).toEqual([-0.5, 0.9].map(Math.fround));
    expect(Array.from(p.slice(2, 4))).toEqual([-1, 0.4].map(Math.fround));
  });

  it('ignores samples outside the declared duration', () => {
    const b = new PeakBuilder(1, 1);
    b.push([Float32Array.of(0.9)], 1, -1);
    b.push([Float32Array.of(0.8)], 1, 5);
    expect(Array.from(b.result())).toEqual([0, 0]);
  });
});
