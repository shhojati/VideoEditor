import { describe, expect, it } from 'vitest';
import { snapBlock, snapTime } from './snapping';

describe('snapTime', () => {
  it('snaps to the closest point inside the threshold', () => {
    expect(snapTime(4.95, [0, 5, 5.2], 0.1)).toEqual({ time: 5, target: 5 });
    expect(snapTime(5.15, [0, 5, 5.2], 0.1)).toEqual({ time: 5.2, target: 5.2 });
  });
  it('leaves the time alone outside the threshold', () => {
    expect(snapTime(3, [0, 5], 0.1)).toEqual({ time: 3 });
  });
});

describe('snapBlock', () => {
  it('snaps by the start edge', () => {
    expect(snapBlock(9.96, 2, [10], 0.1)).toEqual({ time: 10, target: 10 });
  });
  it('snaps by the end edge', () => {
    expect(snapBlock(7.95, 2, [10], 0.1)).toEqual({ time: 8, target: 10 });
  });
  it('prefers the edge that needs the smaller correction', () => {
    expect(snapBlock(3.02, 2, [3, 5.09], 0.1)).toEqual({ time: 3, target: 3 });
  });
});
