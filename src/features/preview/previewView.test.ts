import { describe, expect, it } from 'vitest';
import { backingRatio, clampView, FIT_PADDING, fitView, stepZoom, zoomAt } from './previewView';

const project = { w: 1920, h: 1080 };

describe('preview view', () => {
  it('fit centres the whole picture inside the padding', () => {
    const v = fitView({ w: 1000, h: 1000 }, project);
    expect(v.k).toBeCloseTo((1000 - 2 * FIT_PADDING) / 1920);
    expect(v.ox).toBeCloseTo(FIT_PADDING);
    expect(v.oy + (1080 * v.k) / 2).toBeCloseTo(500);
  });

  it('zooming keeps the point under the pointer fixed', () => {
    const v = { k: 0.5, ox: 10, oy: 20 };
    const z = zoomAt(v, 2, 300, 200);
    const before = { x: (300 - v.ox) / v.k, y: (200 - v.oy) / v.k };
    expect(z.ox + before.x * z.k).toBeCloseTo(300);
    expect(z.oy + before.y * z.k).toBeCloseTo(200);
  });

  it('clamps panning: smaller axes centre, larger ones stop a quarter viewport past the edge', () => {
    const vp = { w: 800, h: 600 };
    const v = clampView({ k: 1, ox: 5000, oy: -9999 }, vp, { w: 1920, h: 400 });
    expect(v.ox).toBe(200); // 800 / 4
    expect(v.oy).toBe(100); // (600 - 400) / 2
    expect(clampView({ k: 1, ox: -5000, oy: 0 }, vp, { w: 1920, h: 400 }).ox).toBe(800 - 1920 - 200);
  });

  it('steps through the presets', () => {
    expect(stepZoom(0.37, 1)).toBe(0.5);
    expect(stepZoom(0.5, 1)).toBe(1);
    expect(stepZoom(0.5, -1)).toBe(0.25);
    expect(stepZoom(4, 1)).toBe(8);
  });

  it('never renders more backing pixels than project pixels below 100%', () => {
    expect(backingRatio(2, 0.25)).toBe(2);
    expect(backingRatio(2, 0.75)).toBeCloseTo(4 / 3);
    expect(backingRatio(2, 3)).toBe(1);
    expect(backingRatio(1, 3)).toBe(1);
  });
});
