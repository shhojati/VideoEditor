import { describe, expect, it } from 'vitest';
import { handles, keyTimeAt, keyToTimeline, mediaTimeAt, meanSpeed, retime, sourceLength, speedAt, timelineTimeAt, type Timing } from './remap';
import type { SpeedPoint } from './types';

const base: Timing = { start: 10, duration: 4, inPoint: 2, speed: 1.5 };
const curve: SpeedPoint[] = [
  [0, 1],
  [0.25, 4],
  [0.6, 0.2],
  [1, 1],
];

describe('linear clips', () => {
  it('match the old formulas exactly', () => {
    for (const t of [9, 10, 11.3, 14, 15]) {
      expect(mediaTimeAt(base, t)).toBe(base.inPoint + (t - base.start) * base.speed);
      expect(timelineTimeAt(base, mediaTimeAt(base, t))).toBeCloseTo(t, 12);
    }
    expect(timelineTimeAt(base, 5)).toBe(base.start + (5 - base.inPoint) / base.speed);
    expect(sourceLength(base)).toBe(6);
    expect(speedAt(base, 12)).toBe(1.5);
    expect(handles(base, 20)).toEqual({ before: 2 / 1.5, after: (20 - 8) / 1.5 });
  });

  it('freeze holds one frame and keys run on local time', () => {
    const f = { ...base, freeze: true as const };
    expect(mediaTimeAt(f, 13)).toBe(2);
    expect(speedAt(f, 13)).toBe(0);
    expect(sourceLength(f)).toBe(0);
    expect(keyTimeAt(f, 12.5)).toBe(2.5);
    expect(keyToTimeline(f, 2.5)).toBe(12.5);
    expect(handles(f, 3)).toEqual({ before: Infinity, after: Infinity });
  });
});

describe('speed curves', () => {
  const c: Timing = { ...base, speedCurve: curve };

  it('integrate the piecewise-linear speed and invert it', () => {
    // Mean = trapezoids: 0.25·2.5 + 0.35·2.1 + 0.4·0.6 = 1.6
    expect(meanSpeed(c)).toBeCloseTo(1.6, 12);
    expect(sourceLength(c)).toBeCloseTo(6.4, 12);
    expect(mediaTimeAt(c, 10)).toBe(2);
    expect(mediaTimeAt(c, 14)).toBeCloseTo(8.4, 12);
    for (let t = 9; t <= 15; t += 0.137) expect(timelineTimeAt(c, mediaTimeAt(c, t))).toBeCloseTo(t, 9);
    // Speed at a knot and between knots.
    expect(speedAt(c, 11)).toBeCloseTo(4);
    expect(speedAt(c, 10.5)).toBeCloseTo(2.5);
  });

  it('split and trim keep every frame where it was', () => {
    for (const clip of [c, base]) {
      const cut = 11.7;
      const left = { ...clip, ...retime(clip, clip.start, cut) };
      const right = { ...clip, ...retime(clip, cut, clip.start + clip.duration) };
      for (let t = 10.05; t < 11.7; t += 0.1) expect(mediaTimeAt(left, t)).toBeCloseTo(mediaTimeAt(clip, t), 9);
      for (let t = 11.75; t < 14; t += 0.1) expect(mediaTimeAt(right, t)).toBeCloseTo(mediaTimeAt(clip, t), 9);
      expect(sourceLength(left) + sourceLength(right)).toBeCloseTo(sourceLength(clip), 9);
      // Outward trim at the start: the edge speed continues.
      const longer = { ...clip, ...retime(clip, 9, clip.start + clip.duration) };
      for (let t = 9.05; t < 14; t += 0.1) expect(mediaTimeAt(longer, t)).toBeCloseTo(mediaTimeAt(clip, t), 9);
    }
  });
});
