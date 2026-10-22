import type { Clip, ShapeProps } from '../../model/types';
import { pathAt } from '../../model/masks';
import { keyTimeAt } from '../../model/remap';
import { fadeAlpha } from '../fade';
import { tracePath } from './masks';
import type { Ctx2D } from './renderFrame';

type Pt = [number, number];
type PathCtx = Pick<Ctx2D, 'moveTo' | 'lineTo' | 'arcTo' | 'closePath'>;

/** Closed polygon with corners rounded by up to `r` (limited by the adjacent edge lengths). */
export function roundedPolygon(ctx: PathCtx, pts: Pt[], r: number) {
  const n = pts.length;
  if (r <= 0) {
    pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    return;
  }
  const mid = (a: Pt, b: Pt): Pt => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const len = (a: Pt, b: Pt) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  ctx.moveTo(...mid(pts[n - 1], pts[0]));
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const next = pts[(i + 1) % n];
    const prev = pts[(i + n - 1) % n];
    // arcTo with a radius that still fits between the edge midpoints.
    const room = Math.min(len(prev, p), len(p, next)) / 2;
    const a1 = Math.atan2(prev[1] - p[1], prev[0] - p[0]);
    const a2 = Math.atan2(next[1] - p[1], next[0] - p[0]);
    let half = Math.abs(a1 - a2) / 2;
    if (half > Math.PI / 2) half = Math.PI - half;
    ctx.arcTo(p[0], p[1], next[0], next[1], Math.min(r, room * Math.tan(half)));
  }
  ctx.closePath();
}

export function starPoints(points: number, inner: number, w: number, h: number): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    const f = i % 2 ? inner : 1;
    pts.push([(Math.cos(a) * w * f) / 2, (Math.sin(a) * h * f) / 2]);
  }
  return pts;
}

/** A regular polygon's corners in a w×h box, the first at the top. */
export function polygonPoints(sides: number, w: number, h: number): Pt[] {
  return Array.from({ length: sides }, (_, i) => {
    const a = -Math.PI / 2 + (i * 2 * Math.PI) / sides;
    return [(Math.cos(a) * w) / 2, (Math.sin(a) * h) / 2] as Pt;
  });
}

/** The fill: a colour, or a gradient across the w×h box (centred on the origin). */
function fillStyle(ctx: Ctx2D, s: ShapeProps, w: number, h: number): string | CanvasGradient {
  const g = s.gradient;
  if (!g || !s.fill) return s.fill!;
  let grad: CanvasGradient;
  if (g.kind === 'radial') grad = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(w, h) / 2);
  else {
    const a = (g.angle * Math.PI) / 180;
    const dx = (Math.cos(a) * w) / 2;
    const dy = (Math.sin(a) * h) / 2;
    grad = ctx.createLinearGradient(-dx, -dy, dx, dy);
  }
  grad.addColorStop(0, s.fill);
  grad.addColorStop(1, g.to);
  return grad;
}

/**
 * Fill the path that `trace` builds with a soft edge `blur` (device px): the shape is drawn out
 * of sight and its blurred shadow lands in place (as the mask feather does). A soft edge is one
 * colour (the fill's first).
 */
function softFill(ctx: Ctx2D, trace: () => void, color: string, blur: number) {
  const m = ctx.getTransform();
  const off = ctx.canvas.width + ctx.canvas.height + 4 * blur;
  ctx.save();
  ctx.setTransform(m.a, m.b, m.c, m.d, m.e - off, m.f);
  trace();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  ctx.shadowOffsetX = off;
  ctx.shadowOffsetY = 0;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

/** Arrowhead length for a line of this (scaled) stroke width. */
export const arrowSize = (strokeWidth: number) => Math.max(12, strokeWidth * 3.5);

/** Outline of a closed shape of w×h centred on the origin (the current path is replaced). */
function closedPath(ctx: Ctx2D, s: ShapeProps, w: number, h: number, r: number) {
  ctx.beginPath();
  switch (s.kind) {
    case 'rectangle':
    case 'square':
      ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(r, w / 2, h / 2));
      return;
    case 'circle':
    case 'oval':
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      return;
    case 'triangle':
      roundedPolygon(ctx, [[0, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]], r);
      return;
    case 'star':
      roundedPolygon(ctx, starPoints(s.points ?? 5, s.innerRadius ?? 0.5, w, h), 0);
      return;
    case 'polygon':
      roundedPolygon(ctx, polygonPoints(s.sides ?? 6, w, h), r);
      return;
  }
}

function setDash(ctx: Ctx2D, dash: ShapeProps['dash'], lw: number) {
  const u = Math.max(lw, 2);
  if (dash === 'dash') ctx.setLineDash([u * 3, u * 2]);
  else if (dash === 'dot') {
    ctx.setLineDash([0, u * 2]);
    ctx.lineCap = 'round';
  } else ctx.setLineDash([]);
}

/** How many device pixels one unit of the current transform is. */
const deviceScale = (ctx: Ctx2D) => {
  const m = ctx.getTransform();
  return Math.hypot(m.a, m.b);
};

/** Draw a shape clip at time t. Position/scale/rotation/opacity come from the clip transform. */
export function drawShapeClip(ctx: Ctx2D, clip: Clip, t: number, canvasW: number, canvasH: number) {
  const s = clip.shape!;
  const alpha = clip.transform.opacity * fadeAlpha(clip, s.fadeIn, s.fadeOut, t);
  if (alpha <= 0) return;
  const k = clip.transform.scale;
  const w = s.width * k;
  const h = s.height * k;
  const lw = s.strokeWidth * k;
  const base = ctx.globalAlpha * alpha;

  ctx.save();
  ctx.translate(canvasW / 2 + clip.transform.x * canvasW, canvasH / 2 + clip.transform.y * canvasH);
  if (clip.transform.rotation) ctx.rotate((clip.transform.rotation * Math.PI) / 180);
  ctx.lineJoin = s.join ?? 'round';
  if (s.join === 'miter') ctx.miterLimit = 10;
  // Shadow on the first thing painted only, so fill + stroke do not double it.
  let shadow = !!(s.shadowColor && s.shadowBlur !== undefined);
  const paint = (fn: () => void) => {
    if (shadow) {
      ctx.shadowColor = s.shadowColor!;
      ctx.shadowBlur = s.shadowBlur! * k;
      ctx.shadowOffsetY = Math.max(w, h) * 0.02;
    }
    fn();
    ctx.shadowColor = 'transparent';
    shadow = false;
  };

  if (s.kind === 'line') {
    const stroke = s.stroke ?? '#ffffff';
    const head = arrowSize(lw);
    // Pull the stroke back under each arrowhead so its end does not poke out of the tip.
    const x0 = -w / 2 + (s.arrowStart ? head * 0.8 : 0);
    const x1 = w / 2 - (s.arrowEnd ? head * 0.8 : 0);
    ctx.globalAlpha = base * (s.strokeOpacity ?? 1);
    if (lw > 0) {
      paint(() => {
        ctx.lineCap = s.arrowStart || s.arrowEnd ? 'butt' : (s.cap ?? 'round');
        setDash(ctx, s.dash, lw);
        ctx.lineWidth = lw;
        ctx.strokeStyle = stroke;
        ctx.beginPath();
        ctx.moveTo(x0, 0);
        ctx.lineTo(x1, 0);
        ctx.stroke();
      });
    }
    ctx.fillStyle = stroke;
    const arrow = (tip: number, dir: 1 | -1) =>
      paint(() => {
        ctx.beginPath();
        ctx.moveTo(tip, 0);
        ctx.lineTo(tip - dir * head, -head * 0.55);
        ctx.lineTo(tip - dir * head, head * 0.55);
        ctx.closePath();
        ctx.fill();
      });
    if (s.arrowEnd) arrow(w / 2, 1);
    if (s.arrowStart) arrow(-w / 2, -1);
    ctx.restore();
    return;
  }

  if (s.kind === 'path') {
    const path = s.path ? pathAt(s.path, keyTimeAt(clip, t)) : [];
    if (path.length < 2) {
      ctx.restore();
      return;
    }
    // Points are project pixels at scale 1 around the position.
    ctx.scale(k, k);
    const trace = () => {
      ctx.beginPath();
      tracePath(ctx, path, !!s.closed);
    };
    trace();
    ctx.lineCap = s.cap ?? 'round';
    if (s.fill && s.closed) {
      ctx.globalAlpha = base * (s.fillOpacity ?? 1);
      const blur = s.feather ? s.feather * k * deviceScale(ctx) : 0;
      if (blur > 0.5) {
        softFill(ctx, trace, s.fill, blur);
        trace();
      } else {
        ctx.fillStyle = fillStyle(ctx, s, s.width, s.height);
        paint(() => ctx.fill());
      }
    }
    if (s.stroke && s.strokeWidth > 0) {
      ctx.globalAlpha = base * (s.strokeOpacity ?? 1);
      setDash(ctx, s.dash, s.strokeWidth);
      ctx.lineWidth = s.strokeWidth;
      ctx.strokeStyle = s.stroke;
      paint(() => ctx.stroke());
    }
    ctx.restore();
    return;
  }

  const trace = () => closedPath(ctx, s, w, h, (s.cornerRadius ?? 0) * k);
  trace();
  if (s.fill) {
    ctx.globalAlpha = base * (s.fillOpacity ?? 1);
    const blur = s.feather ? s.feather * k * deviceScale(ctx) : 0;
    if (blur > 0.5) {
      softFill(ctx, trace, s.fill, blur);
      // The outline (if any) goes on the path in place.
      trace();
    } else {
      ctx.fillStyle = fillStyle(ctx, s, w, h);
      paint(() => ctx.fill());
    }
  }
  if (s.stroke && lw > 0) {
    ctx.globalAlpha = base * (s.strokeOpacity ?? 1);
    setDash(ctx, s.dash, lw);
    ctx.lineWidth = lw;
    ctx.strokeStyle = s.stroke;
    paint(() => ctx.stroke());
  }
  ctx.restore();
}
