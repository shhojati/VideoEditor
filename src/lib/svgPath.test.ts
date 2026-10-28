import { describe, expect, it } from 'vitest';
import { flatten } from '../model/masks';
import { parsePathData, PathDataError, pointsPath, toPathData } from './svgPath';

const xy = (v: number[]) => [v[0], v[1]];

describe('parsePathData', () => {
  it('reads lines, H/V and Z, absolute and relative', () => {
    const [s] = parsePathData('M 10 20 l 30 0 V 50 h -30 z');
    expect(s.closed).toBe(true);
    expect(s.points.map(xy)).toEqual([
      [10, 20],
      [40, 20],
      [40, 50],
      [10, 50],
    ]);
    expect(s.points.every((p) => p.slice(2).every((h) => h === 0))).toBe(true);
  });

  it('merges a closing point that returns to the start', () => {
    const [s] = parsePathData('M0 0 L10 0 L10 10 L0 0Z');
    expect(s.points).toHaveLength(3);
  });

  it('keeps cubic handles relative to their points, and reflects S', () => {
    const [s] = parsePathData('M 0 0 C 40 -60 120 -60 160 0 S 280 60 320 0');
    expect(s.closed).toBe(false);
    expect(s.points[0]).toEqual([0, 0, 0, 0, 40, -60]);
    // 160,0: in-handle to 120,-60, out-handle reflected to 200,60.
    expect(s.points[1]).toEqual([160, 0, -40, -60, 40, 60]);
    expect(s.points[2]).toEqual([320, 0, -40, 60, 0, 0]);
  });

  it('turns quadratics (and T) into the same curve as cubics', () => {
    const [s] = parsePathData('M 0 0 Q 50 100 100 0 T 200 0');
    const [a, b] = s.points;
    // The cubic's handles are 2/3 of the way to the quadratic's control point.
    expect(a[4]).toBeCloseTo(100 / 3);
    expect(a[5]).toBeCloseTo(200 / 3);
    expect(b[2]).toBeCloseTo(-100 / 3);
    expect(b[3]).toBeCloseTo(200 / 3);
    // T reflects the control point to 150,-100.
    expect(b[5]).toBeCloseTo(-200 / 3);
  });

  it('draws arcs on the circle they describe', () => {
    // Two half circles of radius 50 around 0,0.
    const [s] = parsePathData('M -50 0 A 50 50 0 1 0 50 0 A 50 50 0 1 0 -50 0 Z');
    expect(s.closed).toBe(true);
    for (const p of flatten(s.points, 16)) expect(Math.hypot(p.x, p.y)).toBeCloseTo(50, 0);
    // Sweep 0 from the left goes through the bottom first (y down).
    expect(s.points.some((p) => Math.abs(p[1] - 50) < 1e-6 && Math.abs(p[0]) < 1e-6)).toBe(true);
  });

  it('reads arc flags written without separators and numbers without spaces', () => {
    // l -5 -5.5, then .5e1 0 (another segment).
    const [s] = parsePathData('M0,0a10 10 0 0110,10l-5-5.5.5e1 0');
    expect(s.points.at(-1)!.slice(0, 2)).toEqual([10, 4.5]);
  });

  it('splits subpaths at each M', () => {
    const subs = parsePathData('M0 0 L10 0 L10 10 Z M 20 20 L 30 30');
    expect(subs.map((s) => [s.points.length, s.closed])).toEqual([
      [3, true],
      [2, false],
    ]);
  });

  it('says where bad data is', () => {
    expect(() => parsePathData('M 0 0 X 5 5')).toThrow(/command "X" at index 6/);
    expect(() => parsePathData('M 0 0 L 5')).toThrow(PathDataError);
    expect(() => parsePathData('10 10')).toThrow(/start with a command/);
    expect(() => parsePathData('M 0 0 A 5 5 0 2 0 9 9')).toThrow(/arc flag/);
  });
});

describe('toPathData', () => {
  it('writes what it reads', () => {
    const d = 'M 0 0 C 40 -60 120 -60 160 0 L 160 40 Z';
    const [s] = parsePathData(d);
    expect(toPathData(s.points, s.closed)).toBe(d);
  });
});

describe('pointsPath', () => {
  it('passes a smooth curve through the points', () => {
    const pts = pointsPath(
      [
        { x: 0, y: 0 },
        { x: 100, y: 50 },
        { x: 200, y: 0 },
      ],
      false,
      true,
    );
    expect(pts.map(xy)).toEqual([
      [0, 0],
      [100, 50],
      [200, 0],
    ]);
    // The middle point's handles follow the line from its neighbours (here flat).
    expect(pts[1].slice(2)).toEqual([-200 / 6, -0, 200 / 6, 0]);
    expect(pointsPath([{ x: 1, y: 2 }], true, false)).toEqual([[1, 2, 0, 0, 0, 0]]);
  });
});
