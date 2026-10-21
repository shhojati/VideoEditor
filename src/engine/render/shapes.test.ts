import { describe, expect, it } from 'vitest';
import { createProject } from '../../model/factories';
import { defaultShape, setShapeKind } from '../../model/overlays';
import { addShapeClip, findClip } from '../../model/timeline';
import type { ShapeProps } from '../../model/types';
import { parseProject } from '../../model/validate';
import { blendPixels } from './blend';
import { drawShapeClip, roundedPolygon, starPoints } from './shapes';
import type { Ctx2D } from './renderFrame';

/** Records paint operations with the alpha, dash and colour in effect. */
function paintLog() {
  const log: { op: string; alpha: number; dash: number[]; style: string; width: number }[] = [];
  const state = { globalAlpha: 1, fillStyle: '', strokeStyle: '', lineWidth: 1, dash: [] as number[] };
  const stack: (typeof state)[] = [];
  const noop = () => {};
  const ctx = new Proxy(state as unknown as Ctx2D, {
    get(target, key) {
      switch (key) {
        case 'save':
          return () => stack.push({ ...state, dash: [...state.dash] });
        case 'restore':
          return () => Object.assign(state, stack.pop());
        case 'setLineDash':
          return (d: number[]) => (state.dash = d);
        case 'fill':
        case 'stroke':
          return () => log.push({ op: key, alpha: state.globalAlpha, dash: state.dash, style: key === 'fill' ? state.fillStyle : state.strokeStyle, width: state.lineWidth });
        default:
          return key in target ? (target as unknown as Record<string, unknown>)[key as string] : noop;
      }
    },
    set(target, key, v) {
      (target as unknown as Record<string, unknown>)[key as string] = v;
      return true;
    },
  });
  return { ctx, log };
}

const shapeClip = (shape: ShapeProps, opacity = 1) => {
  const p = createProject('t');
  const clip = findClip(p, addShapeClip(p, 0, shape))!.clip;
  clip.transform.opacity = opacity;
  return clip;
};

describe('shapes', () => {
  it('star points alternate outer and inner radius, first point straight up', () => {
    const pts = starPoints(5, 0.5, 200, 200);
    expect(pts).toHaveLength(10);
    expect(pts[0][0]).toBeCloseTo(0);
    expect(pts[0][1]).toBeCloseTo(-100);
    expect(Math.hypot(...pts[1])).toBeCloseTo(50);
  });

  it('a polygon without rounding is plain line segments', () => {
    const ops: string[] = [];
    const rec = { moveTo: () => ops.push('M'), lineTo: () => ops.push('L'), arcTo: () => ops.push('A'), closePath: () => ops.push('Z') };
    roundedPolygon(rec, [[0, 0], [1, 0], [0, 1]], 0);
    expect(ops.join('')).toBe('MLLZ');
    ops.length = 0;
    roundedPolygon(rec, [[0, 0], [1, 0], [0, 1]], 5);
    expect(ops.join('')).toBe('MAAAZ');
  });

  it('fills and strokes with their own opacities times the clip opacity; dashes scale with the width', () => {
    const { ctx, log } = paintLog();
    const s: ShapeProps = { ...defaultShape('square'), fill: '#ff0000', fillOpacity: 0.5, stroke: '#00ff00', strokeWidth: 4, strokeOpacity: 0.25, dash: 'dash' };
    drawShapeClip(ctx, shapeClip(s, 0.8), 1, 1920, 1080);
    expect(log).toEqual([
      { op: 'fill', alpha: 0.4, dash: [], style: '#ff0000', width: 1 },
      { op: 'stroke', alpha: 0.2, dash: [12, 8], style: '#00ff00', width: 4 },
    ]);
  });

  it('lines stroke and draw filled arrowheads; no fill or stroke draws nothing', () => {
    const { ctx, log } = paintLog();
    drawShapeClip(ctx, shapeClip({ ...defaultShape('line'), arrowStart: true, arrowEnd: true }), 1, 1920, 1080);
    expect(log.map((l) => l.op)).toEqual(['stroke', 'fill', 'fill']);
    const empty = paintLog();
    drawShapeClip(empty.ctx, shapeClip({ ...defaultShape('oval'), fill: undefined }), 1, 1920, 1080);
    expect(empty.log).toEqual([]);
  });

  it('switching kind keeps squares square and gives lines a stroke', () => {
    const s = { ...defaultShape('rectangle'), width: 400, height: 200 };
    setShapeKind(s, 'circle');
    expect(s.height).toBe(400);
    setShapeKind(s, 'line');
    expect(s.stroke).toBe('#2563eb');
    expect(s.strokeWidth).toBeGreaterThan(0);
  });

  it('shape clips land on an overlay (text) track and survive validation with a blend mode', () => {
    const p = createProject('t');
    const id = addShapeClip(p, 2, defaultShape('star'));
    const ref = findClip(p, id)!;
    expect(ref.track.kind).toBe('text');
    ref.clip.blend = 'darkerColor';
    expect(findClip(parseProject(JSON.parse(JSON.stringify(p))), id)!.clip).toMatchObject({ blend: 'darkerColor', shape: { kind: 'star' } });
    ref.clip.blend = 'vivid' as never;
    expect(() => parseProject(JSON.parse(JSON.stringify(p)))).toThrow(/blend/);
  });
});

describe('darker color', () => {
  it('keeps the pixel with the lower luma as a whole, not per channel', () => {
    // Source: pure blue (dark luma), backdrop: pure red (brighter luma) → blue stays.
    const src = new Uint8ClampedArray([0, 0, 255, 255, 255, 255, 255, 128, 10, 10, 10, 0]);
    const dst = new Uint8ClampedArray([255, 0, 0, 255, 0, 200, 0, 255, 0, 0, 0, 255]);
    blendPixels('darkerColor', src, dst);
    expect([...src]).toEqual([
      0, 0, 255, 255, // blue is darker than red
      0, 200, 0, 128, // green backdrop is darker than white: take it, keep the source alpha
      10, 10, 10, 0, // transparent source pixels are left alone
    ]);
  });
});
