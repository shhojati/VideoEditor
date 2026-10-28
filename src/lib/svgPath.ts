// SVG path data ("M 0 0 C 40 -60 120 -60 160 0 Z") ↔ the Bézier points shapes and masks use
// (MaskVertex: a point and its in/out handles relative to it). Quadratics become cubics, arcs become
// cubics of at most 90° each. Used by the agent's add_shape and by Paste / Copy SVG path.
import type { MaskVertex } from '../model/types';

export const MAX_PATH_DATA = 20_000;

/** One subpath (from an M to the next M or the end) and whether it ended with Z. */
export interface SubPath {
  points: MaskVertex[];
  closed: boolean;
}

export class PathDataError extends Error {}

const ARGS: Record<string, number> = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 };

/** Commands and their numbers. Arc flags may be written without separators ("a1 1 0 01 5 5"). */
function tokenize(d: string): { cmd: string; args: number[]; at: number }[] {
  const out: { cmd: string; args: number[]; at: number }[] = [];
  const num = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/;
  let i = 0;
  let cur: { cmd: string; args: number[]; at: number } | undefined;
  while (i < d.length) {
    const ch = d[i];
    if (/[\s,]/.test(ch)) {
      i++;
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      if (!(ch.toLowerCase() in ARGS)) throw new PathDataError(`invalid path command "${ch}" at index ${i}`);
      cur = { cmd: ch, args: [], at: i };
      out.push(cur);
      i++;
      continue;
    }
    if (!cur) throw new PathDataError(`path data must start with a command (M), at index ${i}`);
    // The 4th and 5th numbers of each arc are single-digit flags.
    const lower = cur.cmd.toLowerCase();
    const slot = cur.args.length % 7;
    if (lower === 'a' && (slot === 3 || slot === 4)) {
      if (ch !== '0' && ch !== '1') throw new PathDataError(`arc flag must be 0 or 1 at index ${i}`);
      cur.args.push(+ch);
      i++;
      continue;
    }
    const m = num.exec(d.slice(i));
    if (!m) throw new PathDataError(`invalid number at index ${i}`);
    cur.args.push(parseFloat(m[0]));
    i += m[0].length;
  }
  return out;
}

type P = [number, number];

/** Arc (SVG endpoint form) → cubic segments as [c1, c2, end] (SVG spec, appendix F.6). */
function arcToCubics(p0: P, rx: number, ry: number, phi: number, large: boolean, sweep: boolean, p1: P): [P, P, P][] {
  if (rx === 0 || ry === 0 || (p0[0] === p1[0] && p0[1] === p1[1])) return [[p0, p1, p1]];
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1 = cos * dx + sin * dy;
  const y1 = -sin * dx + cos * dy;
  const lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (lambda > 1) {
    rx *= Math.sqrt(lambda);
    ry *= Math.sqrt(lambda);
  }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  let k = Math.sqrt(Math.max(0, num / den));
  if (large === sweep) k = -k;
  const cx1 = (k * rx * y1) / ry;
  const cy1 = (-k * ry * x1) / rx;
  const cx = cos * cx1 - sin * cy1 + (p0[0] + p1[0]) / 2;
  const cy = sin * cx1 + cos * cy1 + (p0[1] + p1[1]) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const t0 = angle(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry);
  let dt = angle((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry);
  if (!sweep && dt > 0) dt -= 2 * Math.PI;
  if (sweep && dt < 0) dt += 2 * Math.PI;
  const n = Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9);
  const step = dt / n;
  const h = (4 / 3) * Math.tan(step / 4);
  const at = (t: number): P => [cx + rx * Math.cos(t) * cos - ry * Math.sin(t) * sin, cy + rx * Math.cos(t) * sin + ry * Math.sin(t) * cos];
  const tangent = (t: number): P => [-rx * Math.sin(t) * cos - ry * Math.cos(t) * sin, -rx * Math.sin(t) * sin + ry * Math.cos(t) * cos];
  const out: [P, P, P][] = [];
  for (let i = 0; i < n; i++) {
    const a = t0 + i * step;
    const b = a + step;
    const pa = i === 0 ? p0 : at(a);
    const pb = i === n - 1 ? p1 : at(b);
    const ta = tangent(a);
    const tb = tangent(b);
    out.push([[pa[0] + h * ta[0], pa[1] + h * ta[1]], [pb[0] - h * tb[0], pb[1] - h * tb[1]], pb]);
  }
  return out;
}

/** Parse SVG path data into subpaths of Bézier points (absolute coordinates). Throws PathDataError. */
export function parsePathData(d: string): SubPath[] {
  if (d.length > MAX_PATH_DATA) throw new PathDataError(`path data is longer than ${MAX_PATH_DATA} characters`);
  const subs: SubPath[] = [];
  let pts: MaskVertex[] = [];
  let cur: P = [0, 0];
  let start: P = [0, 0];
  // The last control point, for S and T reflections.
  let lastCubic: P | undefined;
  let lastQuad: P | undefined;

  const finish = (closed: boolean) => {
    if (!pts.length) return;
    if (closed && pts.length > 1) {
      // A Z after returning to the start point: the last point is the first one.
      const a = pts[0];
      const b = pts[pts.length - 1];
      if (Math.abs(a[0] - b[0]) < 1e-6 && Math.abs(a[1] - b[1]) < 1e-6) {
        a[2] = b[2];
        a[3] = b[3];
        pts.pop();
      }
    }
    subs.push({ points: pts, closed });
    pts = [];
  };
  const moveTo = (p: P) => {
    finish(false);
    pts.push([p[0], p[1], 0, 0, 0, 0]);
    cur = start = p;
  };
  const cubic = (c1: P, c2: P, p: P) => {
    const prev = pts[pts.length - 1];
    prev[4] = c1[0] - prev[0];
    prev[5] = c1[1] - prev[1];
    pts.push([p[0], p[1], c2[0] - p[0], c2[1] - p[1], 0, 0]);
    cur = p;
  };
  const line = (p: P) => {
    pts.push([p[0], p[1], 0, 0, 0, 0]);
    cur = p;
  };

  for (const { cmd, args, at } of tokenize(d)) {
    const lower = cmd.toLowerCase();
    const rel = cmd !== cmd.toUpperCase();
    const n = ARGS[lower];
    if (lower === 'z') {
      if (args.length) throw new PathDataError(`Z takes no numbers, at index ${at}`);
      finish(true);
      // Drawing may go on from the subpath's start without a new M.
      cur = start;
      lastCubic = lastQuad = undefined;
      continue;
    }
    if (!args.length || args.length % n) throw new PathDataError(`"${cmd}" at index ${at} needs ${n} numbers per segment, got ${args.length}`);
    if (lower !== 'm' && !pts.length) pts.push([cur[0], cur[1], 0, 0, 0, 0]);
    for (let i = 0; i < args.length; i += n) {
      const a = args.slice(i, i + n);
      const ox = rel ? cur[0] : 0;
      const oy = rel ? cur[1] : 0;
      const abs = (x: number, y: number): P => [ox + x, oy + y];
      let nextCubic: P | undefined;
      let nextQuad: P | undefined;
      switch (lower) {
        case 'm':
          // Pairs after the first are line-tos.
          if (i === 0) moveTo(abs(a[0], a[1]));
          else line(abs(a[0], a[1]));
          break;
        case 'l':
          line(abs(a[0], a[1]));
          break;
        case 'h':
          line([rel ? cur[0] + a[0] : a[0], cur[1]]);
          break;
        case 'v':
          line([cur[0], rel ? cur[1] + a[0] : a[0]]);
          break;
        case 'c': {
          const c2 = abs(a[2], a[3]);
          cubic(abs(a[0], a[1]), c2, abs(a[4], a[5]));
          nextCubic = c2;
          break;
        }
        case 's': {
          const c1: P = lastCubic ? [2 * cur[0] - lastCubic[0], 2 * cur[1] - lastCubic[1]] : cur;
          const c2 = abs(a[0], a[1]);
          cubic(c1, c2, abs(a[2], a[3]));
          nextCubic = c2;
          break;
        }
        case 'q':
        case 't': {
          const q: P = lower === 'q' ? abs(a[0], a[1]) : lastQuad ? [2 * cur[0] - lastQuad[0], 2 * cur[1] - lastQuad[1]] : cur;
          const p = lower === 'q' ? abs(a[2], a[3]) : abs(a[0], a[1]);
          const p0 = cur;
          cubic([p0[0] + (2 / 3) * (q[0] - p0[0]), p0[1] + (2 / 3) * (q[1] - p0[1])], [p[0] + (2 / 3) * (q[0] - p[0]), p[1] + (2 / 3) * (q[1] - p[1])], p);
          nextQuad = q;
          break;
        }
        case 'a':
          for (const [c1, c2, p] of arcToCubics(cur, a[0], a[1], (a[2] * Math.PI) / 180, !!a[3], !!a[4], abs(a[5], a[6]))) {
            if (c1 === cur && c2 === p) line(p);
            else cubic(c1, c2, p);
          }
          break;
      }
      lastCubic = nextCubic;
      lastQuad = nextQuad;
    }
  }
  finish(false);
  if (!subs.length) throw new PathDataError('path data has no points');
  return subs;
}

const fmt = (v: number) => String(Math.round(v * 100) / 100);

/** Bézier points → SVG path data (absolute; straight segments as L). */
export function toPathData(points: readonly MaskVertex[], closed: boolean): string {
  if (!points.length) return '';
  const n = points.length;
  const parts = [`M ${fmt(points[0][0])} ${fmt(points[0][1])}`];
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    if (a[4] || a[5] || b[2] || b[3])
      parts.push(`C ${fmt(a[0] + a[4])} ${fmt(a[1] + a[5])} ${fmt(b[0] + b[2])} ${fmt(b[1] + b[3])} ${fmt(b[0])} ${fmt(b[1])}`);
    // A straight way back to the start is the Z.
    else if (!(closed && i === n - 1)) parts.push(`L ${fmt(b[0])} ${fmt(b[1])}`);
  }
  if (closed) parts.push('Z');
  return parts.join(' ');
}

/**
 * Bézier points through `pts` (Catmull-Rom: each point's handles follow its neighbours), or a
 * plain polygon / polyline when not smooth.
 */
export function pointsPath(pts: readonly { x: number; y: number }[], closed: boolean, smooth: boolean): MaskVertex[] {
  const n = pts.length;
  return pts.map(({ x, y }, i): MaskVertex => {
    if (!smooth) return [x, y, 0, 0, 0, 0];
    const prev = pts[closed ? (i + n - 1) % n : Math.max(0, i - 1)];
    const next = pts[closed ? (i + 1) % n : Math.min(n - 1, i + 1)];
    const tx = (next.x - prev.x) / 6;
    const ty = (next.y - prev.y) / 6;
    return [x, y, -tx, -ty, tx, ty];
  });
}
