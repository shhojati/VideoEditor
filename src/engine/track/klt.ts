// Box tracker for motion tracking. Corner features inside the box are followed frame to frame with
// pyramidal Lucas–Kanade (checked forwards and backwards); each feature remembers where it sits in
// the box, and a robust similarity fit (RANSAC, then least squares) from those box positions to
// where the features are now gives the box's position, rotation and scale. Fitting against the box
// rather than chaining frame-to-frame steps keeps rotation and scale from drifting.
// Pure (typed arrays in, numbers out): runs in the tracking worker and in unit tests.

export interface Gray {
  w: number;
  h: number;
  data: Float32Array;
}

export interface Pt {
  x: number;
  y: number;
}

/** Box centre (px), angle (radians, clockwise) and scale relative to the box size it was started with. */
export interface BoxPose {
  cx: number;
  cy: number;
  angle: number;
  scale: number;
}

/** Rec. 601 luma of RGBA pixels, 0..255. */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const data = new Float32Array(w * h);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) data[i] = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
  return { w, h, data };
}

/** Blur with [1 2 1]/4 in both directions and keep every second pixel. */
function half(g: Gray): Gray {
  const w = Math.max(1, g.w >> 1);
  const h = Math.max(1, g.h >> 1);
  const tmp = new Float32Array(g.w * h);
  const at = (x: number, y: number) => g.data[Math.min(g.h - 1, Math.max(0, y)) * g.w + x];
  for (let y = 0; y < h; y++) for (let x = 0; x < g.w; x++) tmp[y * g.w + x] = (at(x, 2 * y - 1) + 2 * at(x, 2 * y) + at(x, 2 * y + 1)) / 4;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const row = y * g.w;
      const l = tmp[row + Math.max(0, 2 * x - 1)];
      const r = tmp[row + Math.min(g.w - 1, 2 * x + 1)];
      out[y * w + x] = (l + 2 * tmp[row + 2 * x] + r) / 4;
    }
  return { w, h, data: out };
}

/** An image pyramid with gradients, prepared once per frame. */
export interface Frame {
  levels: Gray[];
  gx: Float32Array[];
  gy: Float32Array[];
}

/** Scharr-like gradient (3×3, weights 3/10/3), scaled to intensity per pixel. */
function gradients(g: Gray): { gx: Float32Array; gy: Float32Array } {
  const { w, h, data } = g;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const ym = Math.max(0, y - 1) * w;
    const y0 = y * w;
    const yp = Math.min(h - 1, y + 1) * w;
    for (let x = 0; x < w; x++) {
      const xm = Math.max(0, x - 1);
      const xp = Math.min(w - 1, x + 1);
      gx[y0 + x] = (3 * (data[ym + xp] - data[ym + xm]) + 10 * (data[y0 + xp] - data[y0 + xm]) + 3 * (data[yp + xp] - data[yp + xm])) / 32;
      gy[y0 + x] = (3 * (data[yp + xm] - data[ym + xm]) + 10 * (data[yp + x] - data[ym + x]) + 3 * (data[yp + xp] - data[ym + xp])) / 32;
    }
  }
  return { gx, gy };
}

export function prepare(g: Gray, maxLevels = 4): Frame {
  const levels = [g];
  while (levels.length < maxLevels && levels[levels.length - 1].w >= 40 && levels[levels.length - 1].h >= 40) levels.push(half(levels[levels.length - 1]));
  const grads = levels.map(gradients);
  return { levels, gx: grads.map((x) => x.gx), gy: grads.map((x) => x.gy) };
}

/** Bilinear sample with clamped edges. */
function sample(data: Float32Array, w: number, h: number, x: number, y: number): number {
  x = Math.min(w - 1.001, Math.max(0, x));
  y = Math.min(h - 1.001, Math.max(0, y));
  const x0 = x | 0;
  const y0 = y | 0;
  const fx = x - x0;
  const fy = y - y0;
  const i = y0 * w + x0;
  const a = data[i] + (data[i + 1] - data[i]) * fx;
  const b = data[i + w] + (data[i + w + 1] - data[i + w]) * fx;
  return a + (b - a) * fy;
}

const WIN = 7; // window radius: 15×15
const ITERATIONS = 20;

/**
 * Pyramidal Lucas–Kanade: where each point of `prev` is in `next` (null when it cannot be
 * followed). `guess` is an optional predicted position per point.
 */
export function lkTrack(prev: Frame, next: Frame, pts: readonly Pt[], guess?: readonly Pt[]): (Pt | null)[] {
  const top = Math.min(prev.levels.length, next.levels.length) - 1;
  const n = (2 * WIN + 1) ** 2;
  const ip = new Float32Array(n);
  const ix = new Float32Array(n);
  const iy = new Float32Array(n);
  return pts.map((p, idx) => {
    const g = guess?.[idx] ?? p;
    let dx = (g.x - p.x) / 2 ** top;
    let dy = (g.y - p.y) / 2 ** top;
    for (let L = top; L >= 0; L--) {
      const P = prev.levels[L];
      const N = next.levels[L];
      const px = p.x / 2 ** L;
      const py = p.y / 2 ** L;
      let a = 0;
      let b = 0;
      let c = 0;
      let k = 0;
      for (let j = -WIN; j <= WIN; j++)
        for (let i = -WIN; i <= WIN; i++, k++) {
          ip[k] = sample(P.data, P.w, P.h, px + i, py + j);
          ix[k] = sample(prev.gx[L], P.w, P.h, px + i, py + j);
          iy[k] = sample(prev.gy[L], P.w, P.h, px + i, py + j);
          a += ix[k] * ix[k];
          b += ix[k] * iy[k];
          c += iy[k] * iy[k];
        }
      const det = a * c - b * b;
      if (det < 1e-6 * n * n) return null;
      for (let it = 0; it < ITERATIONS; it++) {
        let bx = 0;
        let by = 0;
        k = 0;
        for (let j = -WIN; j <= WIN; j++)
          for (let i = -WIN; i <= WIN; i++, k++) {
            const diff = ip[k] - sample(N.data, N.w, N.h, px + i + dx, py + j + dy);
            bx += diff * ix[k];
            by += diff * iy[k];
          }
        const ux = (c * bx - b * by) / det;
        const uy = (a * by - b * bx) / det;
        dx += ux;
        dy += uy;
        if (ux * ux + uy * uy < 1e-4) break;
      }
      if (L > 0) {
        dx *= 2;
        dy *= 2;
      }
    }
    const x = p.x + dx;
    const y = p.y + dy;
    const g0 = next.levels[0];
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > g0.w - 1 || y > g0.h - 1) return null;
    return { x, y };
  });
}

/** Weakest corner accepted: summed over the 5×5 window, i.e. a gradient of about 2 levels/px across. */
const MIN_CORNER = 25 * 2 * 2;

/**
 * Corners (Shi–Tomasi: strongest minimum eigenvalue of the structure tensor) inside `inside`,
 * searched in the bounding box, at least `minDist` apart, strongest first.
 */
export function goodFeatures(f: Frame, bbox: { x0: number; y0: number; x1: number; y1: number }, inside: (p: Pt) => boolean, max: number, minDist: number, avoid: readonly Pt[] = []): Pt[] {
  const g = f.levels[0];
  const gx = f.gx[0];
  const gy = f.gy[0];
  const x0 = Math.max(2, Math.floor(bbox.x0));
  const y0 = Math.max(2, Math.floor(bbox.y0));
  const x1 = Math.min(g.w - 3, Math.ceil(bbox.x1));
  const y1 = Math.min(g.h - 3, Math.ceil(bbox.y1));
  const cands: { x: number; y: number; q: number }[] = [];
  let best = 0;
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!inside({ x, y })) continue;
      let a = 0;
      let b = 0;
      let c = 0;
      for (let j = -2; j <= 2; j++)
        for (let i = -2; i <= 2; i++) {
          const k = (y + j) * g.w + x + i;
          a += gx[k] * gx[k];
          b += gx[k] * gy[k];
          c += gy[k] * gy[k];
        }
      const q = (a + c) / 2 - Math.sqrt(((a - c) / 2) ** 2 + b * b);
      if (q > 0) {
        cands.push({ x, y, q });
        if (q > best) best = q;
      }
    }
  // Relative to the strongest corner, with a floor so flat noise is not picked up.
  const threshold = Math.max(best * 0.02, MIN_CORNER);
  cands.sort((p, q) => q.q - p.q);
  const out: Pt[] = [];
  const taken = [...avoid];
  const d2 = minDist * minDist;
  for (const p of cands) {
    if (p.q < threshold || out.length >= max) break;
    if (taken.some((t) => (t.x - p.x) ** 2 + (t.y - p.y) ** 2 < d2)) continue;
    out.push({ x: p.x, y: p.y });
    taken.push(p);
  }
  return out;
}

/** p ≈ R(angle)·scale·l + t, as complex a = scale·e^(i·angle) (y down, so positive turns clockwise). */
export interface Similarity {
  ar: number;
  ai: number;
  tx: number;
  ty: number;
}

export const applySim = (m: Similarity, l: Pt): Pt => ({ x: m.ar * l.x - m.ai * l.y + m.tx, y: m.ai * l.x + m.ar * l.y + m.ty });

/** Least-squares similarity mapping `from` onto `to` (null when degenerate). */
export function fitSimilarity(from: readonly Pt[], to: readonly Pt[]): Similarity | null {
  const n = from.length;
  if (n < 2) return null;
  let fx = 0;
  let fy = 0;
  let tx = 0;
  let ty = 0;
  for (let i = 0; i < n; i++) {
    fx += from[i].x;
    fy += from[i].y;
    tx += to[i].x;
    ty += to[i].y;
  }
  fx /= n;
  fy /= n;
  tx /= n;
  ty /= n;
  let sr = 0;
  let si = 0;
  let norm = 0;
  for (let i = 0; i < n; i++) {
    const lx = from[i].x - fx;
    const ly = from[i].y - fy;
    const px = to[i].x - tx;
    const py = to[i].y - ty;
    sr += px * lx + py * ly;
    si += py * lx - px * ly;
    norm += lx * lx + ly * ly;
  }
  if (norm < 1e-9) return null;
  const ar = sr / norm;
  const ai = si / norm;
  return { ar, ai, tx: tx - (ar * fx - ai * fy), ty: ty - (ai * fx + ar * fy) };
}

/** Deterministic PRNG (mulberry32) so tracking is repeatable. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RANSAC over point pairs, then least squares on the inliers. Returns the model and inlier mask. */
export function robustSimilarity(from: readonly Pt[], to: readonly Pt[], threshold: number, iterations = 80): { model: Similarity; inliers: boolean[] } | null {
  const n = from.length;
  if (n < 2) return null;
  const rand = rng(n * 7919);
  const t2 = threshold * threshold;
  const inliersOf = (m: Similarity) =>
    from.map((l, i) => {
      const p = applySim(m, l);
      return (p.x - to[i].x) ** 2 + (p.y - to[i].y) ** 2 <= t2;
    });
  let best: boolean[] | null = null;
  let bestCount = 0;
  for (let it = 0; it < iterations; it++) {
    const i = Math.floor(rand() * n);
    let j = Math.floor(rand() * (n - 1));
    if (j >= i) j++;
    const m = fitSimilarity([from[i], from[j]], [to[i], to[j]]);
    if (!m) continue;
    const mask = inliersOf(m);
    const count = mask.filter(Boolean).length;
    if (count > bestCount) {
      best = mask;
      bestCount = count;
      if (count === n) break;
    }
  }
  if (!best || bestCount < 2) return null;
  let mask = best;
  let model: Similarity | null = null;
  for (let round = 0; round < 2; round++) {
    const idx = mask.flatMap((ok, i) => (ok ? [i] : []));
    const m = fitSimilarity(idx.map((i) => from[i]), idx.map((i) => to[i]));
    if (!m) break;
    model = m;
    mask = inliersOf(m);
  }
  return model ? { model, inliers: mask } : null;
}

/** The (2·WIN+1)² patch around p, axis-aligned, in pixel steps. */
function patch(g: Gray, p: Pt): Float32Array {
  const out = new Float32Array((2 * WIN + 1) ** 2);
  let k = 0;
  for (let j = -WIN; j <= WIN; j++) for (let i = -WIN; i <= WIN; i++) out[k++] = sample(g.data, g.w, g.h, p.x + i, p.y + j);
  return out;
}

/**
 * Align a feature's original patch, turned and scaled by the linear map [a −b; b a], with the frame
 * near p: translation-only Lucas–Kanade with the mean brightness removed. Null when the patch no
 * longer matches (appearance changed) or would move too far.
 */
function refine(f: Frame, tpl: Float32Array, p: Pt, a: number, b: number): Pt | null {
  const g = f.levels[0];
  const n = tpl.length;
  let tMean = 0;
  for (const v of tpl) tMean += v;
  tMean /= n;
  let tVar = 0;
  for (const v of tpl) tVar += (v - tMean) ** 2;
  if (tVar < 1e-6) return null;
  const iv = new Float32Array(n);
  const ix = new Float32Array(n);
  const iy = new Float32Array(n);
  let x = p.x;
  let y = p.y;
  let err = Infinity;
  for (let it = 0; it < 10; it++) {
    let k = 0;
    let mean = 0;
    for (let j = -WIN; j <= WIN; j++)
      for (let i = -WIN; i <= WIN; i++, k++) {
        const sx = x + a * i - b * j;
        const sy = y + b * i + a * j;
        iv[k] = sample(g.data, g.w, g.h, sx, sy);
        ix[k] = sample(f.gx[0], g.w, g.h, sx, sy);
        iy[k] = sample(f.gy[0], g.w, g.h, sx, sy);
        mean += iv[k];
      }
    mean /= n;
    let A = 0;
    let B = 0;
    let C = 0;
    let bx = 0;
    let by = 0;
    err = 0;
    for (k = 0; k < n; k++) {
      const e = tpl[k] - tMean - (iv[k] - mean);
      A += ix[k] * ix[k];
      B += ix[k] * iy[k];
      C += iy[k] * iy[k];
      bx += e * ix[k];
      by += e * iy[k];
      err += e * e;
    }
    const det = A * C - B * B;
    if (det <= 1e-9) return null;
    const ux = (C * bx - B * by) / det;
    const uy = (A * by - B * bx) / det;
    x += ux;
    y += uy;
    if (ux * ux + uy * uy < 1e-4) break;
  }
  if (err / tVar > REFINE_RESIDUAL || Math.hypot(x - p.x, y - p.y) > REFINE_MAX_SHIFT) return null;
  return { x, y };
}

interface Feature {
  /** Where it is now (px). */
  x: number;
  y: number;
  /** Where it sits in the box at scale 1, relative to the centre, unrotated. */
  lx: number;
  ly: number;
  /** Its patch when found, and the box's angle and scale then. */
  tpl: Float32Array;
  a0: number;
  s0: number;
  /** Frames in a row it did not match its patch. */
  misses: number;
}

export class TrackingError extends Error {}

const MAX_FEATURES = 80;
const FB_ERROR = 1; // px: forward–backward check
/** Refinement against the original patch: largest residual (share of the patch's contrast) and shift (px). */
const REFINE_RESIDUAL = 0.3;
const REFINE_MAX_SHIFT = 3;
/** A feature that misses its patch this many frames in a row is replaced. */
const MAX_MISSES = 3;
/** Lost after this many frames in a row where few features match their patches (a cut, a cover-up). */
const MAX_WEAK = 3;

/**
 * Follows a box (size w×h px at scale 1) from frame to frame. `step` returns the new pose, or
 * null when the object is lost.
 */
export class BoxTracker {
  private frame: Frame;
  private features: Feature[] = [];
  private velocity: Pt = { x: 0, y: 0 };
  private weak = 0;
  /** Whether the last step matched the object's appearance (false: carried by motion only). */
  confident = true;
  private readonly target: number;

  constructor(
    first: Gray,
    readonly w: number,
    readonly h: number,
    public pose: BoxPose,
  ) {
    this.frame = prepare(first);
    this.detect();
    if (this.features.length < 6) throw new TrackingError('featureless');
    this.target = this.features.length;
  }

  private toLocal(p: Pt): Pt {
    const { cx, cy, angle, scale } = this.pose;
    const dx = p.x - cx;
    const dy = p.y - cy;
    const c = Math.cos(angle);
    const s = Math.sin(angle);
    return { x: (c * dx + s * dy) / scale, y: (-s * dx + c * dy) / scale };
  }

  /** Add features inside the current box, away from the ones already followed. */
  private detect() {
    const { cx, cy, scale } = this.pose;
    const hw = (this.w * scale) / 2;
    const hh = (this.h * scale) / 2;
    const r = Math.hypot(hw, hh);
    const minDist = Math.max(3, Math.min(hw, hh) / 8);
    const inside = (p: Pt) => {
      const l = this.toLocal(p);
      return Math.abs(l.x) <= this.w / 2 && Math.abs(l.y) <= this.h / 2;
    };
    const found = goodFeatures(this.frame, { x0: cx - r, y0: cy - r, x1: cx + r, y1: cy + r }, inside, MAX_FEATURES - this.features.length, minDist, this.features);
    for (const p of found) {
      const l = this.toLocal(p);
      this.features.push({ x: p.x, y: p.y, lx: l.x, ly: l.y, tpl: patch(this.frame.levels[0], p), a0: this.pose.angle, s0: this.pose.scale, misses: 0 });
    }
  }

  step(next: Gray): BoxPose | null {
    this.confident = false;
    const nf = prepare(next);
    const pts = this.features.map((f) => ({ x: f.x, y: f.y }));
    const guess = pts.map((p) => ({ x: p.x + this.velocity.x, y: p.y + this.velocity.y }));
    const fwd = lkTrack(this.frame, nf, pts, guess);
    const back = lkTrack(nf, this.frame, fwd.map((p, i) => p ?? pts[i]), pts);
    const kept: Feature[] = [];
    fwd.forEach((p, i) => {
      const b = back[i];
      if (p && b && Math.hypot(b.x - pts[i].x, b.y - pts[i].y) <= FB_ERROR) kept.push({ ...this.features[i], x: p.x, y: p.y });
    });
    if (kept.length < 4) return null;
    const size = Math.min(this.w, this.h) * this.pose.scale;
    const fitBox = (list: readonly Feature[], threshold: number) => {
      const fit = robustSimilarity(
        list.map((f) => ({ x: f.lx, y: f.ly })),
        list.map((f) => ({ x: f.x, y: f.y })),
        threshold,
      );
      return fit && { model: fit.model, inliers: list.filter((_, i) => fit.inliers[i]) };
    };
    let fit = fitBox(kept, Math.max(2, size * 0.05));
    if (!fit || fit.inliers.length < 4 || fit.inliers.length < this.target * 0.15) return null;
    // Frame-to-frame steps drift; pull each feature onto its original patch (turned and scaled by
    // the box) and fit again.
    {
      const { ar, ai } = fit.model;
      let matched = 0;
      const refined = fit.inliers.map((f) => {
        const k = Math.hypot(ar, ai) / f.s0;
        const da = Math.atan2(ai, ar) - f.a0;
        const r = refine(nf, f.tpl, f, k * Math.cos(da), k * Math.sin(da));
        if (!r) return { ...f, misses: f.misses + 1 };
        matched++;
        return { ...f, x: r.x, y: r.y, misses: 0 };
      });
      this.confident = matched >= Math.max(4, this.target * 0.3);
      this.weak = this.confident ? 0 : this.weak + 1;
      if (this.weak >= MAX_WEAK) return null;
      const again = fitBox(refined, Math.max(1.5, size * 0.03));
      if (again && again.inliers.length >= Math.max(4, fit.inliers.length * 0.5)) fit = again;
    }
    const inliers = fit.inliers;
    const { ar, ai, tx, ty } = fit.model;
    const scale = Math.hypot(ar, ai);
    // Unwrapped angle: the step closest to the previous angle.
    let angle = Math.atan2(ai, ar);
    angle += 2 * Math.PI * Math.round((this.pose.angle - angle) / (2 * Math.PI));
    const ratio = scale / this.pose.scale;
    if (ratio < 0.75 || ratio > 1.33 || Math.abs(angle - this.pose.angle) > 0.5) return null;
    this.velocity = { x: tx - this.pose.cx, y: ty - this.pose.cy };
    this.pose = { cx: tx, cy: ty, angle, scale };
    this.frame = nf;
    // Keep the features that agree with the box and are still near it.
    this.features = inliers.filter((f) => {
      if (f.misses >= MAX_MISSES) return false;
      const l = this.toLocal(f);
      return Math.abs(l.x) <= this.w * 0.6 && Math.abs(l.y) <= this.h * 0.6;
    });
    // Only replenish while the object is recognised, so a cut is not tracked as a new object.
    if (this.confident && this.features.length < this.target * 0.6) this.detect();
    if (this.features.length < 4) return null;
    return this.pose;
  }
}
