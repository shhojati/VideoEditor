// Drawing brush strokes. Each stroke's outline is a variable-width polygon (perfect-freehand); a
// soft edge is the shadow of that polygon drawn out of sight (blurs the same way in every browser
// and in workers, unlike ctx.filter). The strokes of a clip are rasterised into two canvases at the
// target's resolution, kept until the visible strokes or the view change:
//   paint — the brush strokes, with the erasers after them rubbing them out;
//   erase — where any eraser went, to rub out the clip's own pixels.
// On a clip, the picture is drawn, `erase` cut out of it, then `paint` drawn over it: the same as
// painting stroke by stroke for brushes and erasers. Clone strokes copy the clip's pixels and are
// drawn each frame.
import { getStroke } from 'perfect-freehand';
import { pointsUpTo, strokesAt, type ShownStroke } from '../../model/paint';
import type { PaintProps, PaintStroke } from '../../model/types';
import { affineScale, type Affine } from './masks';
import type { Ctx2D } from './renderFrame';

/** The stroke's outline polygon (layer units) for the first `upTo` of its length. */
export function strokeOutline(stroke: PaintStroke, upTo = 1): number[][] {
  const pts = pointsUpTo(stroke.points, upTo);
  if (!pts.length) return [];
  return getStroke(pts, {
    size: stroke.size,
    // Pressure from a pen thins the line; a mouse or finger draws an even one.
    thinning: stroke.pressure ? 0.6 : 0,
    smoothing: 0.5,
    streamline: 0.4,
    simulatePressure: false,
    last: upTo >= 1,
  });
}

/** SVG path data of an outline (for the live stroke on the preview overlay). */
export function outlineD(outline: number[][], map: (x: number, y: number) => [number, number]): string {
  if (!outline.length) return '';
  return outline.map(([x, y], i) => `${i ? 'L' : 'M'}${map(x, y).join(',')}`).join('') + 'Z';
}

function trace(c: Ctx2D, outline: number[][]) {
  c.beginPath();
  outline.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
  c.closePath();
}

/** Fill one stroke's coverage with `style` through the layer → canvas transform T (soft edge from its hardness). */
export function fillStroke(c: Ctx2D, s: ShownStroke, T: Affine, style: string) {
  const outline = strokeOutline(s.stroke, s.upTo);
  if (outline.length < 3) return;
  const blur = (1 - s.stroke.hardness) * (s.stroke.size / 2) * affineScale(T);
  c.save();
  c.globalAlpha *= s.stroke.opacity;
  c.fillStyle = style;
  if (blur > 0.5) {
    // Drawn out of sight; its blurred shadow lands where the stroke goes.
    const off = c.canvas.width + c.canvas.height + 4 * blur;
    c.setTransform(T[0], T[1], T[2], T[3], T[4] - off, T[5]);
    c.shadowColor = style;
    c.shadowBlur = blur;
    c.shadowOffsetX = off;
  } else c.setTransform(...T);
  trace(c, outline);
  c.fill();
  c.restore();
}

interface Raster {
  key: string;
  paint: OffscreenCanvas;
  erase: OffscreenCanvas | null;
}

/** Rasterised strokes per clip (a handful: preview plus the clips on screen). */
const cache = new Map<string, Raster>();
const CACHE_SIZE = 12;

const keyOf = (shown: ShownStroke[], T: Affine, w: number, h: number) =>
  `${w}x${h}|${T.map((v) => v.toFixed(3)).join(',')}|${shown.map((s) => `${s.stroke.id}:${s.stroke.points.length}:${s.upTo.toFixed(4)}`).join(';')}`;

function canvas(c: OffscreenCanvas | null | undefined, w: number, h: number) {
  if (!c) return new OffscreenCanvas(w, h);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  } else c.getContext('2d')!.clearRect(0, 0, w, h);
  return c;
}

/**
 * The brush and eraser strokes of a clip showing at source time s, rasterised at w × h through
 * T (layer units → those pixels). `id` keys the cache (the clip's id plus where it is drawn).
 */
export function paintRaster(id: string, paint: PaintProps, s: number, T: Affine, w: number, h: number): Raster | null {
  const shown = strokesAt(paint, s).filter((x) => x.stroke.tool !== 'clone');
  if (!shown.length) return null;
  const key = keyOf(shown, T, w, h);
  const old = cache.get(id);
  if (old?.key === key) {
    // Most recently used last.
    cache.delete(id);
    cache.set(id, old);
    return old;
  }
  const hasErase = shown.some((x) => x.stroke.tool === 'eraser');
  const r: Raster = { key, paint: canvas(old?.paint, w, h), erase: hasErase ? canvas(old?.erase, w, h) : null };
  const pc = r.paint.getContext('2d')!;
  const ec = r.erase?.getContext('2d');
  for (const x of shown) {
    if (x.stroke.tool === 'eraser') {
      pc.globalCompositeOperation = 'destination-out';
      fillStroke(pc, x, T, '#000');
      pc.globalCompositeOperation = 'source-over';
      fillStroke(ec!, x, T, '#000');
    } else fillStroke(pc, x, T, x.stroke.color);
  }
  cache.delete(id);
  cache.set(id, r);
  while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!);
  return r;
}

/** Scratch canvases for clone strokes: the picture they copy from, and one stroke's copy. */
const scratch: OffscreenCanvas[] = [];

function scratchCtx(i: number, w: number, h: number) {
  const c = (scratch[i] = canvas(scratch[i], w, h));
  const x = c.getContext('2d')!;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  return x;
}

/**
 * Clone stamp strokes: inside each stroke, the picture `source` (pixels of the same size as the
 * target) taken from `clone` away. Drawn every frame (the picture under them moves).
 */
function drawClones(ctx: Ctx2D, clones: ShownStroke[], T: Affine, source: CanvasImageSource) {
  const { width: w, height: h } = ctx.canvas;
  const snap = scratchCtx(0, w, h);
  // The picture as it was before any clone stroke, so strokes don't copy each other.
  snap.drawImage(source, 0, 0);
  for (const x of clones) {
    const { dx, dy } = x.stroke.clone!;
    const c = scratchCtx(1, w, h);
    fillStroke(c, x, T, '#000');
    c.globalCompositeOperation = 'source-in';
    // A pixel at p shows the picture at p + (dx, dy) (through T's linear part).
    c.drawImage(snap.canvas, -(T[0] * dx + T[2] * dy), -(T[1] * dx + T[3] * dy));
    ctx.drawImage(c.canvas, 0, 0);
  }
}

/**
 * Paint a clip's strokes at source time s onto `ctx`, whose current transform maps layer units
 * to its pixels and which holds the clip's picture alone (when the strokes rub out or copy it).
 * Clone strokes copy from `source` (a paint layer: what is drawn below it), by default the
 * picture in `ctx`. `cacheId` names this clip and use.
 */
export function drawPaint(ctx: Ctx2D, paint: PaintProps, s: number, cacheId: string, source?: CanvasImageSource) {
  const m = ctx.getTransform();
  const T: Affine = [m.a, m.b, m.c, m.d, m.e, m.f];
  const { width: w, height: h } = ctx.canvas;
  const clones = strokesAt(paint, s).filter((x) => x.stroke.tool === 'clone' && x.stroke.clone);
  const r = paintRaster(cacheId, paint, s, T, w, h);
  if (!r && !clones.length) return;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (clones.length) {
    ctx.save();
    // The clip's own clip region (crop) stays; the copies are drawn in pixels.
    drawClones(ctx, clones, T, source ?? ctx.canvas);
    ctx.restore();
  }
  if (!r) {
    ctx.restore();
    return;
  }
  if (r.erase) {
    const a = ctx.globalAlpha;
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'destination-out';
    ctx.drawImage(r.erase, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = a;
  }
  ctx.drawImage(r.paint, 0, 0);
  ctx.restore();
}
