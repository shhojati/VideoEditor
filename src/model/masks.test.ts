import { describe, expect, it } from 'vitest';
import {
  bezierPoint,
  closestOnPath,
  createMask,
  ellipsePath,
  insertVertex,
  insidePath,
  lerpNumber,
  mapPaths,
  maskKeyTimes,
  pathAt,
  pathBounds,
  polygonPath,
  rectPath,
  removeVertices,
  segment,
  setAnimated,
  setAt,
  toggleKeyAt,
  toggleSmooth,
  valueAt,
} from './masks';
import { migrate } from './migrations';
import { parseProject } from './validate';
import type { Animated } from './types';

const TOL = 0.01;

describe('mask paths', () => {
  it('makes rectangles, ellipses and polygons clockwise from the top', () => {
    expect(rectPath(0, 0, 100, 50).map((v) => [v[0], v[1]])).toEqual([[-50, -25], [50, -25], [50, 25], [-50, 25]]);
    const e = ellipsePath(10, 20, 200, 100);
    expect([e[0][0], e[0][1]]).toEqual([10, -30]);
    // The Bézier quarter circle stays within 0.03 % of the true radius.
    const mid = bezierPoint(segment(ellipsePath(0, 0, 200, 200), 0), 0.5);
    expect(Math.hypot(mid.x, mid.y)).toBeCloseTo(100, 1);
    const pent = polygonPath(0, 0, 100, 100);
    expect(pent).toHaveLength(5);
    expect(pent[0][1]).toBeCloseTo(-50);
    expect(pathBounds(ellipsePath(0, 0, 200, 100))).toMatchObject({ width: expect.closeTo(200, 0), height: expect.closeTo(100, 0) });
  });

  it('adds a point without changing the curve', () => {
    const path = ellipsePath(0, 0, 200, 100);
    const before = bezierPoint(segment(path, 1), 0.3);
    const out = insertVertex(path, 1, 0.3);
    expect(out).toHaveLength(5);
    expect(out[2][0]).toBeCloseTo(before.x);
    expect(out[2][1]).toBeCloseTo(before.y);
    // Both halves trace the original segment.
    expect(bezierPoint(segment(out, 1), 0.5).x).toBeCloseTo(bezierPoint(segment(path, 1), 0.15).x);
    expect(bezierPoint(segment(out, 2), 0.5).y).toBeCloseTo(bezierPoint(segment(path, 1), 0.65).y);
  });

  it('removes points but keeps three, and toggles corner ↔ smooth', () => {
    const r = rectPath(0, 0, 10, 10);
    expect(removeVertices(r, new Set([0]))).toHaveLength(3);
    expect(removeVertices(r, new Set([0, 1]))).toBe(r);
    const smooth = toggleSmooth(r, 1);
    expect(smooth[1].slice(2).some((x) => x !== 0)).toBe(true);
    expect(toggleSmooth(smooth, 1)[1].slice(2)).toEqual([0, 0, 0, 0]);
  });

  it('hit-tests the inside and finds the closest point on the outline', () => {
    const r = rectPath(0, 0, 100, 100);
    expect(insidePath(r, { x: 10, y: -10 })).toBe(true);
    expect(insidePath(r, { x: 60, y: 0 })).toBe(false);
    const c = closestOnPath(r, { x: 0, y: -53 });
    expect(c.seg).toBe(0);
    expect(c.u).toBeCloseTo(0.5, 1);
    expect(c.dist).toBeCloseTo(3, 0);
  });
});

describe('keyframes', () => {
  it('interpolates linearly and holds outside the keys', () => {
    const a: Animated<number> = { value: 5, keys: [{ t: 1, v: 0 }, { t: 3, v: 10 }] };
    expect(valueAt(a, 0, lerpNumber)).toBe(0);
    expect(valueAt(a, 2, lerpNumber)).toBe(5);
    expect(valueAt(a, 9, lerpNumber)).toBe(10);
    expect(valueAt({ value: 7 }, 2, lerpNumber)).toBe(7);
  });

  it('sets a key at the time (replacing one within the tolerance) only when animated', () => {
    const still: Animated<number> = { value: 1 };
    setAt(still, 2, 4, TOL);
    expect(still).toEqual({ value: 4 });
    const a: Animated<number> = { value: 0, keys: [{ t: 1, v: 0 }] };
    setAt(a, 3, 9, TOL);
    setAt(a, 2, 5, TOL);
    setAt(a, 2.005, 6, TOL);
    expect(a.keys).toEqual([{ t: 1, v: 0 }, { t: 2, v: 6 }, { t: 3, v: 9 }]);
  });

  it('stopwatch on keys the current value; off keeps the value at the playhead', () => {
    const a: Animated<number> = { value: 3 };
    setAnimated(a, true, 1, lerpNumber);
    expect(a.keys).toEqual([{ t: 1, v: 3 }]);
    setAt(a, 3, 7, TOL);
    setAnimated(a, false, 2, lerpNumber);
    expect(a).toEqual({ value: 5 });
  });

  it('toggles a key at the playhead; removing the last one stops the animation', () => {
    const a: Animated<number> = { value: 2, keys: [{ t: 0, v: 0 }, { t: 2, v: 4 }] };
    toggleKeyAt(a, 1, TOL, lerpNumber);
    expect(a.keys).toEqual([{ t: 0, v: 0 }, { t: 1, v: 2 }, { t: 2, v: 4 }]);
    toggleKeyAt(a, 0, TOL, lerpNumber);
    toggleKeyAt(a, 1, TOL, lerpNumber);
    toggleKeyAt(a, 2, TOL, lerpNumber);
    expect(a).toEqual({ value: 4 });
  });

  it('interpolates paths point by point and edits every key in step', () => {
    const m = createMask('Mask 1', rectPath(0, 0, 100, 100));
    m.path.keys = [{ t: 0, v: rectPath(0, 0, 100, 100) }, { t: 2, v: rectPath(50, 0, 100, 100) }];
    m.opacity.keys = [{ t: 1.5, v: 0.5 }];
    expect(pathAt(m.path, 1)[0][0]).toBe(-25);
    mapPaths(m, (p) => insertVertex(p, 0, 0.5));
    expect(m.path.keys.map((k) => k.v.length)).toEqual([5, 5]);
    expect(m.path.value).toHaveLength(5);
    expect(maskKeyTimes(m)).toEqual([0, 1.5, 2]);
  });
});

describe('stored projects', () => {
  it('turns an old adjustment-layer mask into a roto mask path', () => {
    const clip = {
      id: 'adj',
      start: 0,
      duration: 2,
      inPoint: 0,
      speed: 1,
      adjustment: true,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
      audio: { volume: 1, fadeIn: 0, fadeOut: 0 },
      mask: { kind: 'ellipse', width: 200, height: 100, feather: 12 },
    };
    const v1 = {
      id: 'p',
      name: 'p',
      version: 1,
      settings: { width: 1920, height: 1080, fps: 30, sampleRate: 48000 },
      assets: {},
      tracks: [{ id: 't', kind: 'text', muted: false, locked: false, clips: [clip] }],
      subtitleTracks: [],
    };
    const doc = migrate(v1);
    expect(v1.tracks[0].clips[0].mask).toBeDefined(); // the input is left alone
    const p = parseProject(doc);
    const c = p.tracks[0].clips[0];
    expect(c).not.toHaveProperty('mask');
    expect(c.masks).toHaveLength(1);
    expect(c.masks![0]).toMatchObject({ mode: 'add', feather: { value: 12 }, path: { value: ellipsePath(0, 0, 200, 100) } });
  });

  it('validates masks', () => {
    const p = parseProject(
      migrate({
        id: 'p',
        name: 'p',
        version: 2,
        settings: { width: 100, height: 100, fps: 30, sampleRate: 48000 },
        assets: {},
        tracks: [],
        subtitleTracks: [],
      }),
    );
    p.tracks.push({ id: 't', kind: 'text', muted: false, locked: false, clips: [] });
    const m = createMask('M', rectPath(0, 0, 10, 10));
    p.tracks[0].clips.push({ id: 'c', start: 0, duration: 1, inPoint: 0, speed: 1, adjustment: true, transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, audio: { volume: 1, fadeIn: 0, fadeOut: 0 }, masks: [m] });
    expect(parseProject(JSON.parse(JSON.stringify(p))).tracks[0].clips[0].masks![0].id).toBe(m.id);
    m.opacity = { value: 2 };
    expect(() => parseProject(JSON.parse(JSON.stringify(p)))).toThrow(/masks/);
  });
});
