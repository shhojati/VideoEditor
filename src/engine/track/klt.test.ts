import { describe, expect, it } from 'vitest';
import { BoxTracker, fitSimilarity, robustSimilarity, TrackingError, type Gray, type Pt } from './klt';

const W = 320;
const H = 240;

/** A smooth texture with dense blobs: corners everywhere, no repeating pattern at small shifts. */
function texture(seed: number) {
  let s = seed;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // Rendered once on a grid covering every place the tests sample, then sampled bilinearly.
  const X0 = -160;
  const Y0 = -160;
  const GW = 680;
  const GH = 560;
  const grid = new Float32Array(GW * GH);
  for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) grid[y * GW + x] = 128 + 20 * Math.sin(0.11 * (x + X0) + 0.07 * (y + Y0) + seed);
  for (let n = 0; n < 2500; n++) {
    const bx = rand() * GW;
    const by = rand() * GH;
    const r = 2 + rand() * 4;
    const v = rand() * 140 - 70;
    for (let y = Math.max(0, Math.floor(by - 3 * r)); y < Math.min(GH, by + 3 * r); y++)
      for (let x = Math.max(0, Math.floor(bx - 3 * r)); x < Math.min(GW, bx + 3 * r); x++)
        grid[y * GW + x] += v * Math.exp(-((x - bx) ** 2 + (y - by) ** 2) / (2 * r * r));
  }
  return (x: number, y: number) => {
    const gx = Math.min(GW - 1.001, Math.max(0, x - X0));
    const gy = Math.min(GH - 1.001, Math.max(0, y - Y0));
    const ix = gx | 0;
    const iy = gy | 0;
    const fx = gx - ix;
    const fy = gy - iy;
    const i = iy * GW + ix;
    const top = grid[i] + (grid[i + 1] - grid[i]) * fx;
    const bot = grid[i + GW] + (grid[i + GW + 1] - grid[i + GW]) * fx;
    return top + (bot - top) * fy;
  };
}

/** Draw `fg` moved by the similarity (about (cx0, cy0)) over a static `bg`, inside a disc of radius `radius` (Infinity: whole frame). */
function frame(fg: (x: number, y: number) => number, bg: (x: number, y: number) => number, pose: { cx: number; cy: number; angle: number; scale: number }, cx0: number, cy0: number, radius = Infinity): Gray {
  const data = new Float32Array(W * H);
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const dx = x - pose.cx;
      const dy = y - pose.cy;
      const lx = (c * dx + s * dy) / pose.scale;
      const ly = (-s * dx + c * dy) / pose.scale;
      data[y * W + x] = lx * lx + ly * ly <= radius * radius ? fg(cx0 + lx, cy0 + ly) : bg(x, y);
    }
  return { w: W, h: H, data };
}

describe('similarity fit', () => {
  it('recovers rotation, scale and translation exactly', () => {
    const from: Pt[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 5 }, { x: -3, y: 7 }];
    const a = 0.3;
    const k = 1.7;
    const to = from.map((p) => ({ x: k * (Math.cos(a) * p.x - Math.sin(a) * p.y) + 4, y: k * (Math.sin(a) * p.x + Math.cos(a) * p.y) - 2 }));
    const m = fitSimilarity(from, to)!;
    expect(Math.atan2(m.ai, m.ar)).toBeCloseTo(a);
    expect(Math.hypot(m.ar, m.ai)).toBeCloseTo(k);
    expect([m.tx, m.ty].map((v) => +v.toFixed(6))).toEqual([4, -2]);
  });

  it('ignores outliers', () => {
    const from: Pt[] = Array.from({ length: 30 }, (_, i) => ({ x: (i % 6) * 5, y: Math.floor(i / 6) * 5 }));
    const to = from.map((p, i) => (i % 5 === 0 ? { x: 99, y: -50 + i } : { x: p.x + 3, y: p.y - 1 }));
    const r = robustSimilarity(from, to, 0.5)!;
    expect(r.inliers.filter(Boolean)).toHaveLength(24);
    expect(r.model.tx).toBeCloseTo(3);
    expect(r.model.ty).toBeCloseTo(-1);
  });
});

describe('BoxTracker', () => {
  it('follows translation, rotation and scale of the whole picture', () => {
    const tex = texture(7);
    const start = { cx: 160, cy: 120, angle: 0, scale: 1 };
    const tracker = new BoxTracker(frame(tex, tex, start, 160, 120), 80, 60, start);
    let truth = start;
    for (let i = 1; i <= 30; i++) {
      truth = { cx: 160 + i * 1.5, cy: 120 - i * 0.8, angle: i * 0.012, scale: 1 + i * 0.006 };
      const pose = tracker.step(frame(tex, tex, truth, 160, 120));
      expect(pose).not.toBeNull();
    }
    const p = tracker.pose;
    expect(p.cx).toBeCloseTo(truth.cx, 0);
    expect(p.cy).toBeCloseTo(truth.cy, 0);
    expect(p.angle).toBeCloseTo(truth.angle, 2);
    expect(p.scale).toBeCloseTo(truth.scale, 2);
  });

  it('follows an object over a different, still background (box drawn a little loose)', () => {
    const obj = texture(11);
    const bg = texture(23);
    const start = { cx: 100, cy: 120, angle: 0, scale: 1 };
    // Disc of radius 40; box 90×90 so its corners are background.
    const tracker = new BoxTracker(frame(obj, bg, start, 100, 120, 40), 90, 90, start);
    let truth = start;
    for (let i = 1; i <= 40; i++) {
      truth = { cx: 100 + i * 2.5, cy: 120 + Math.sin(i / 6) * 10, angle: -i * 0.01, scale: 1 };
      expect(tracker.step(frame(obj, bg, truth, 100, 120, 40))).not.toBeNull();
    }
    // Features on the object's outline see the background slide past: sub-pixel noise, no drift.
    expect(Math.abs(tracker.pose.cx - truth.cx)).toBeLessThan(1.5);
    expect(Math.abs(tracker.pose.cy - truth.cy)).toBeLessThan(1.5);
    expect(tracker.pose.angle).toBeCloseTo(truth.angle, 1);
    expect(tracker.confident).toBe(true);
  });

  it('reports a lost object and refuses a featureless box', () => {
    const tex = texture(3);
    const start = { cx: 160, cy: 120, angle: 0, scale: 1 };
    const tracker = new BoxTracker(frame(tex, tex, start, 160, 120), 60, 60, start);
    // A cut to another picture: lost (at most a couple of frames carried without confidence).
    const other = frame(texture(99), texture(99), start, 160, 120);
    const steps = Array.from({ length: 4 }, () => [tracker.step(other), tracker.confident] as const);
    expect(steps.every(([, confident]) => !confident)).toBe(true);
    expect(steps.some(([pose]) => pose === null)).toBe(true);
    const flat: Gray = { w: W, h: H, data: new Float32Array(W * H).fill(90) };
    expect(() => new BoxTracker(flat, 60, 60, start)).toThrow(TrackingError);
  });
});
