// Roto masks as data: ready-made paths, keyframed values and path edits that keep every keyframe
// in step (same vertex count, so paths can be interpolated). Pure; positions are layer units (see
// MaskVertex). Where a mask is drawn on the canvas is engine/render/masks.ts.
import { newId } from './factories';
import type { Animated, Clip, MaskVertex, RotoMask } from './types';

export interface Pt {
  x: number;
  y: number;
}

/** Bézier handle length for a quarter circle. */
export const KAPPA = 0.5522847498;

/** Clockwise from the top-left corner. */
export function rectPath(cx: number, cy: number, w: number, h: number): MaskVertex[] {
  const x0 = cx - w / 2;
  const y0 = cy - h / 2;
  return [
    [x0, y0, 0, 0, 0, 0],
    [x0 + w, y0, 0, 0, 0, 0],
    [x0 + w, y0 + h, 0, 0, 0, 0],
    [x0, y0 + h, 0, 0, 0, 0],
  ];
}

/** Four smooth points, clockwise from the top. */
export function ellipsePath(cx: number, cy: number, w: number, h: number): MaskVertex[] {
  const rx = w / 2;
  const ry = h / 2;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return [
    [cx, cy - ry, -kx, 0, kx, 0],
    [cx + rx, cy, 0, -ky, 0, ky],
    [cx, cy + ry, kx, 0, -kx, 0],
    [cx - rx, cy, 0, ky, 0, -ky],
  ];
}

/** A regular polygon with `n` corners inside a w × h box, clockwise from the top. */
export function polygonPath(cx: number, cy: number, w: number, h: number, n = 5): MaskVertex[] {
  return Array.from({ length: n }, (_, i) => {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    return [cx + (Math.cos(a) * w) / 2, cy + (Math.sin(a) * h) / 2, 0, 0, 0, 0] as MaskVertex;
  });
}

export type MaskPreset = 'rectangle' | 'ellipse' | 'polygon';

export function presetPath(kind: MaskPreset, cx: number, cy: number, w: number, h: number): MaskVertex[] {
  if (kind === 'ellipse') return ellipsePath(cx, cy, w, h);
  if (kind === 'polygon') return polygonPath(cx, cy, w, h);
  return rectPath(cx, cy, w, h);
}

export function createMask(name: string, path: MaskVertex[], over: Partial<Pick<RotoMask, 'mode' | 'inverted'>> & { feather?: number } = {}): RotoMask {
  return {
    id: newId(),
    name,
    mode: over.mode ?? 'add',
    ...(over.inverted ? { inverted: true } : {}),
    path: { value: path },
    feather: { value: over.feather ?? 0 },
    expansion: { value: 0 },
    opacity: { value: 1 },
  };
}

// ---- keyframed values -----------------------------------------------------------------------------

export type Lerp<T> = (a: T, b: T, f: number) => T;

export const lerpNumber: Lerp<number> = (a, b, f) => a + (b - a) * f;

export const lerpPath: Lerp<MaskVertex[]> = (a, b, f) =>
  a.map((v, i) => {
    const w = b[i] ?? v;
    return v.map((x, j) => x + (w[j] - x) * f) as MaskVertex;
  });

/** The value at source time s: linear between keys, held before the first and after the last. */
export function valueAt<T>(a: Animated<T>, s: number, lerp: Lerp<T>): T {
  const keys = a.keys;
  if (!keys?.length) return a.value;
  if (s <= keys[0].t) return keys[0].v;
  const last = keys[keys.length - 1];
  if (s >= last.t) return last.v;
  let i = 1;
  while (keys[i].t < s) i++;
  const p = keys[i - 1];
  const q = keys[i];
  return lerp(p.v, q.v, (s - p.t) / (q.t - p.t || 1));
}

export const numberAt = (a: Animated<number>, s: number) => valueAt(a, s, lerpNumber);
export const pathAt = (a: Animated<MaskVertex[]>, s: number) => valueAt(a, s, lerpPath);

/** How close (source s) two times must be to count as the same keyframe: half a frame. */
export const keyTolerance = (fps: number, speed = 1) => (0.5 / fps) * speed;

export const keyIndexAt = <T>(a: Animated<T>, s: number, tol: number) => a.keys?.findIndex((k) => Math.abs(k.t - s) <= tol) ?? -1;

/** Set the value at source time s: a keyframe there when animated (added if missing), else the value. */
export function setAt<T>(a: Animated<T>, s: number, v: T, tol: number) {
  if (!a.keys) {
    a.value = v;
    return;
  }
  const i = keyIndexAt(a, s, tol);
  if (i >= 0) a.keys[i].v = v;
  else {
    const j = a.keys.findIndex((k) => k.t > s);
    a.keys.splice(j < 0 ? a.keys.length : j, 0, { t: s, v });
  }
}

/** The stopwatch: turning it on keys the current value at s; off keeps the value at s. */
export function setAnimated<T>(a: Animated<T>, on: boolean, s: number, lerp: Lerp<T>) {
  const now = valueAt(a, s, lerp);
  if (on) a.keys = [{ t: s, v: now }];
  else {
    a.value = now;
    delete a.keys;
  }
}

/** Add a keyframe at s with the current value, or remove the one there. The last key removed stops the animation. */
export function toggleKeyAt<T>(a: Animated<T>, s: number, tol: number, lerp: Lerp<T>) {
  const i = keyIndexAt(a, s, tol);
  if (i < 0) {
    if (!a.keys) a.keys = [];
    setAt(a, s, valueAt(a, s, lerp), tol);
    return;
  }
  const [gone] = a.keys!.splice(i, 1);
  if (!a.keys!.length) {
    a.value = gone.v;
    delete a.keys;
  }
}

/** All keyframe times of a mask, sorted and without duplicates. */
export function maskKeyTimes(m: RotoMask): number[] {
  const out = new Set<number>();
  for (const a of [m.path, m.feather, m.expansion, m.opacity] as Animated<unknown>[]) for (const k of a.keys ?? []) out.add(k.t);
  return [...out].sort((x, y) => x - y);
}

export const clipKeyTimes = (clip: Clip) => [...new Set((clip.masks ?? []).flatMap(maskKeyTimes))].sort((x, y) => x - y);

/** Apply `fn` to the path everywhere it is stored (value and every key), keeping keys in step. */
export function mapPaths(m: RotoMask, fn: (p: MaskVertex[]) => MaskVertex[]) {
  m.path.value = fn(m.path.value);
  for (const k of m.path.keys ?? []) k.v = fn(k.v);
}

// ---- path geometry --------------------------------------------------------------------------------

/** The cubic Bézier from vertex i to the next one (the path is closed). */
export function segment(path: MaskVertex[], i: number): [Pt, Pt, Pt, Pt] {
  const a = path[i];
  const b = path[(i + 1) % path.length];
  return [
    { x: a[0], y: a[1] },
    { x: a[0] + a[4], y: a[1] + a[5] },
    { x: b[0] + b[2], y: b[1] + b[3] },
    { x: b[0], y: b[1] },
  ];
}

export function bezierPoint([p0, p1, p2, p3]: [Pt, Pt, Pt, Pt], u: number): Pt {
  const v = 1 - u;
  const a = v * v * v;
  const b = 3 * v * v * u;
  const c = 3 * v * u * u;
  const d = u * u * u;
  return { x: a * p0.x + b * p1.x + c * p2.x + d * p3.x, y: a * p0.y + b * p1.y + c * p2.y + d * p3.y };
}

/** Points along the closed path (for hit tests and bounds). */
export function flatten(path: MaskVertex[], steps = 16): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < path.length; i++) {
    const seg = segment(path, i);
    for (let k = 0; k < steps; k++) out.push(bezierPoint(seg, k / steps));
  }
  return out;
}

export function pathBounds(path: MaskVertex[]) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of flatten(path)) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 };
}

/** The closest point on the path to p: segment index, curve parameter and distance. */
export function closestOnPath(path: MaskVertex[], p: Pt): { seg: number; u: number; dist: number } {
  let best = { seg: 0, u: 0, dist: Infinity };
  const steps = 48;
  for (let i = 0; i < path.length; i++) {
    const seg = segment(path, i);
    for (let k = 0; k <= steps; k++) {
      const q = bezierPoint(seg, k / steps);
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d < best.dist) best = { seg: i, u: k / steps, dist: d };
    }
  }
  return best;
}

/** Even-odd point-in-path test on the flattened curve. */
export function insidePath(path: MaskVertex[], p: Pt): boolean {
  const pts = flatten(path);
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Split segment `seg` at u (de Casteljau): a new vertex that leaves the curve's shape unchanged. */
export function insertVertex(path: MaskVertex[], seg: number, u: number): MaskVertex[] {
  const [p0, p1, p2, p3] = segment(path, seg);
  const mix = (a: Pt, b: Pt): Pt => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
  const q0 = mix(p0, p1);
  const q1 = mix(p1, p2);
  const q2 = mix(p2, p3);
  const r0 = mix(q0, q1);
  const r1 = mix(q1, q2);
  const s = mix(r0, r1);
  const out = path.map((v) => [...v] as MaskVertex);
  const a = out[seg];
  const bi = (seg + 1) % path.length;
  const b = out[bi];
  a[4] = q0.x - a[0];
  a[5] = q0.y - a[1];
  b[2] = q2.x - b[0];
  b[3] = q2.y - b[1];
  out.splice(seg + 1, 0, [s.x, s.y, r0.x - s.x, r0.y - s.y, r1.x - s.x, r1.y - s.y]);
  return out;
}

/** Remove vertices; a path keeps at least three. */
export function removeVertices(path: MaskVertex[], indices: ReadonlySet<number>): MaskVertex[] {
  const out = path.filter((_, i) => !indices.has(i));
  return out.length >= 3 ? out : path;
}

/** Corner (no handles) ↔ smooth (handles along the neighbours' direction, a third of the way to them). */
export function toggleSmooth(path: MaskVertex[], i: number): MaskVertex[] {
  const out = path.map((v) => [...v] as MaskVertex);
  const v = out[i];
  if (v[2] || v[3] || v[4] || v[5]) {
    v[2] = v[3] = v[4] = v[5] = 0;
    return out;
  }
  const prev = path[(i - 1 + path.length) % path.length];
  const next = path[(i + 1) % path.length];
  const dx = next[0] - prev[0];
  const dy = next[1] - prev[1];
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const din = Math.hypot(v[0] - prev[0], v[1] - prev[1]) / 3;
  const dout = Math.hypot(next[0] - v[0], next[1] - v[1]) / 3;
  v[2] = -ux * din;
  v[3] = -uy * din;
  v[4] = ux * dout;
  v[5] = uy * dout;
  return out;
}

/** Move a point by a similarity map: `pt` for positions, `vec` for the handles (no translation). */
export function mapVertices(path: MaskVertex[], pt: (p: Pt) => Pt, vec: (p: Pt) => Pt): MaskVertex[] {
  return path.map((v) => {
    const p = pt({ x: v[0], y: v[1] });
    const a = vec({ x: v[2], y: v[3] });
    const b = vec({ x: v[4], y: v[5] });
    return [p.x, p.y, a.x, a.y, b.x, b.y];
  });
}
