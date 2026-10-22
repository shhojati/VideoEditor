import { describe, expect, it } from 'vitest';
import { createProject } from './factories';
import { isOverlay, isPaintLayer } from './overlays';
import { celStart, celStep, newStrokeTiming, pointsUpTo, strokesAt, touchesPixels } from './paint';
import { addPaintClip, findClip } from './timeline';
import type { PaintProps, PaintStroke } from './types';
import { parseProject } from './validate';

const stroke = (over: Partial<PaintStroke> = {}): PaintStroke => ({
  id: over.id ?? 's',
  tool: 'brush',
  points: [0, 0, 0.5, 10, 0, 0.5, 10, 10, 0.5],
  size: 4,
  hardness: 1,
  opacity: 1,
  color: '#f00',
  start: 1,
  ...over,
});

describe('paint', () => {
  it('a stroke shows from its start, to the end or for its duration', () => {
    const paint: PaintProps = { strokes: [stroke({ id: 'a' }), stroke({ id: 'b', duration: 0.5 })] };
    expect(strokesAt(paint, 0.9).map((x) => x.stroke.id)).toEqual([]);
    expect(strokesAt(paint, 1).map((x) => x.stroke.id)).toEqual(['a', 'b']);
    expect(strokesAt(paint, 1.6).map((x) => x.stroke.id)).toEqual(['a']);
    expect(strokesAt(paint, 99).map((x) => x.stroke.id)).toEqual(['a']);
  });

  it('Write On draws the stroke along its length over time', () => {
    const paint: PaintProps = { strokes: [stroke({ writeOn: 2 })] };
    expect(strokesAt(paint, 1)).toEqual([]);
    expect(strokesAt(paint, 2)[0].upTo).toBeCloseTo(0.5);
    expect(strokesAt(paint, 4)[0].upTo).toBe(1);
    // Half of a 20-long path ends at the corner; three quarters is half way down the second side.
    const pts = stroke().points;
    expect(pointsUpTo(pts, 0.5).at(-1)).toEqual([10, 0, 0.5]);
    expect(pointsUpTo(pts, 0.75).at(-1)).toEqual([10, 5, 0.5]);
    expect(pointsUpTo(pts, 1)).toHaveLength(3);
  });

  it('erasers and clones need the clip on a layer of its own', () => {
    expect(touchesPixels({ strokes: [stroke()] })).toBe(false);
    expect(touchesPixels({ strokes: [stroke(), stroke({ tool: 'eraser' })] })).toBe(true);
  });

  it('frame-by-frame: drawings hold their frames', () => {
    // On twos at 30 fps a drawing lasts 2/30 s.
    expect(celStart(0.1, 2, 30)).toBeCloseTo(2 / 30);
    expect(celStart(4 / 30, 2, 30)).toBeCloseTo(4 / 30);
    expect(celStep(0.1, 2, 30, 1)).toBeCloseTo(4 / 30);
    expect(celStep(0.01, 2, 30, -1)).toBe(0);
    expect(newStrokeTiming({ strokes: [], frames: { hold: 2 } }, 0.1, 30)).toEqual({ start: celStart(0.1, 2, 30), duration: 2 / 30 });
    expect(newStrokeTiming({ strokes: [] }, 0.1, 30)).toEqual({ start: 0.1 });
  });

  it('a paint layer is an overlay and survives saving', () => {
    const p = createProject('t');
    const id = addPaintClip(p, 1, { strokes: [stroke({ tool: 'eraser', pressure: true, writeOn: 1 })], frames: { hold: 2 } });
    const clip = findClip(p, id)!.clip;
    expect(isPaintLayer(clip) && isOverlay(clip)).toBe(true);
    const back = parseProject(JSON.parse(JSON.stringify(p)));
    expect(findClip(back, id)!.clip.paint).toEqual(clip.paint);
  });
});
