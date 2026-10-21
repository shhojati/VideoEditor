// Pure maths behind some effects (unit tested): curve lookup tables, corner-pin homographies,
// affine transforms, and deterministic particles.

/**
 * 256-entry curve through points at inputs 0, .25, .5, .75, 1 (outputs 0..1), with monotone cubic
 * (Fritsch–Carlson) interpolation so the curve never overshoots between points.
 */
export function curveLut(ys: readonly number[]): Uint8Array {
  const n = ys.length;
  const xs = ys.map((_, i) => i / (n - 1));
  const d = xs.slice(1).map((x, i) => (ys[i + 1] - ys[i]) / (x - xs[i]));
  const m = ys.map((_, i) => (i === 0 ? d[0] : i === n - 1 ? d[n - 2] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2));
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  const out = new Uint8Array(256 * 4);
  for (let v = 0; v < 256; v++) {
    const x = v / 255;
    const i = Math.min(n - 2, Math.floor(x * (n - 1)));
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const y = (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
    const b = Math.round(Math.min(1, Math.max(0, y)) * 255);
    out.set([b, b, b, 255], v * 4);
  }
  return out;
}

/** Levels as a lookup table (input black/white, gamma, output black/white in 0..255). */
export function levelsLut(inBlack: number, inWhite: number, gamma: number, outBlack: number, outWhite: number): Uint8Array {
  const out = new Uint8Array(256 * 4);
  for (let v = 0; v < 256; v++) {
    const x = Math.min(1, Math.max(0, (v - inBlack) / Math.max(1, inWhite - inBlack)));
    const y = Math.round(outBlack + Math.pow(x, 1 / Math.max(0.01, gamma)) * (outWhite - outBlack));
    const b = Math.min(255, Math.max(0, y));
    out.set([b, b, b, 255], v * 4);
  }
  return out;
}

type P = readonly [number, number];

/** 3×3 homography (row-major) mapping the 4 points `from` onto `to`. */
export function homography(from: readonly P[], to: readonly P[]): number[] {
  // Solve the 8 unknowns h0..h7 (h8 = 1) with Gaussian elimination.
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [u, v] = to[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let c = 0; c < 8; c++) {
    let piv = c;
    for (let r = c + 1; r < 8; r++) if (Math.abs(A[r][c]) > Math.abs(A[piv][c])) piv = r;
    [A[c], A[piv]] = [A[piv], A[c]];
    const div = A[c][c] || 1e-12;
    for (let k = c; k < 9; k++) A[c][k] /= div;
    for (let r = 0; r < 8; r++) {
      if (r === c) continue;
      const f = A[r][c];
      for (let k = c; k < 9; k++) A[r][k] -= f * A[c][k];
    }
  }
  return [...A.map((row) => row[8]), 1];
}

export const applyHomography = (h: readonly number[], [x, y]: P): [number, number] => {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
};

/** Row-major 3×3 → column-major, as WebGL's uniformMatrix3fv expects. */
export const columnMajor = (m: readonly number[]) => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

/**
 * Transform effect, forward matrix (2×2, row-major [a, b, c, d]) for scale (1 = 100 %), rotation
 * and skew (degrees) along an axis, in y-up pixel space (positive rotation = clockwise on screen).
 */
export function transformMatrix(scale: number, rotationDeg: number, skewDeg: number, skewAxisDeg: number): [number, number, number, number] {
  const mul = (p: number[], q: number[]) => [p[0] * q[0] + p[1] * q[2], p[0] * q[1] + p[1] * q[3], p[2] * q[0] + p[3] * q[2], p[2] * q[1] + p[3] * q[3]];
  const rot = (deg: number) => {
    const r = (-deg * Math.PI) / 180; // y up: clockwise on screen is negative
    return [Math.cos(r), -Math.sin(r), Math.sin(r), Math.cos(r)];
  };
  const k = Math.tan((skewDeg * Math.PI) / 180);
  const skew = mul(mul(rot(skewAxisDeg), [1, k, 0, 1]), rot(-skewAxisDeg));
  const m = mul(rot(rotationDeg), mul(skew, [scale, 0, 0, scale]));
  return m as [number, number, number, number];
}

export function invert2(m: readonly number[]): [number, number, number, number] {
  const det = m[0] * m[3] - m[1] * m[2] || 1e-9;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
}

/** 0..1 pseudo-random per (index, salt), stable across frames. */
export function rand(i: number, salt: number) {
  let h = Math.imul(i * 374761393 + salt * 668265263, 1274126177);
  h ^= h >>> 13;
  h = Math.imul(h, 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

export interface Particle {
  x: number;
  y: number;
  /** 0 at birth → 1 at death. */
  age: number;
  size: number;
  /** 0..1 depth (World only; 1 = near). */
  z: number;
}

export interface ParticleParams {
  /** Producer position, px (y down). */
  x: number;
  y: number;
  birthRate: number;
  longevity: number;
  /** px/s */
  velocity: number;
  /** Spread (deg) around straight up; 360 = all directions. */
  spread: number;
  /** px/s², positive = down. */
  gravity: number;
  size: number;
  /** World: particles move in depth too. */
  depth: number;
}

/**
 * Particles alive at time `t` (s since the clip start), computed in closed form — particle i is
 * born at i / birthRate with its own random direction and speed — so any frame can be drawn
 * without simulating the ones before it.
 */
export function particlesAt(t: number, p: ParticleParams, max = 4000): Particle[] {
  const out: Particle[] = [];
  if (t < 0 || p.birthRate <= 0) return out;
  const first = Math.max(0, Math.ceil((t - p.longevity) * p.birthRate));
  const last = Math.floor(t * p.birthRate);
  for (let i = Math.max(first, last - max + 1); i <= last; i++) {
    const age = t - i / p.birthRate;
    if (age < 0 || age >= p.longevity) continue;
    const dir = (-90 + (rand(i, 1) - 0.5) * p.spread) * (Math.PI / 180);
    const speed = p.velocity * (0.5 + rand(i, 2));
    const z = p.depth > 0 ? (rand(i, 3) - 0.5) * 2 : 0;
    const persp = 1 / (1 - z * p.depth * 0.6 * Math.min(1, age));
    out.push({
      x: p.x + Math.cos(dir) * speed * age * persp,
      y: p.y + (Math.sin(dir) * speed * age + 0.5 * p.gravity * age * age) * persp,
      age: age / p.longevity,
      size: p.size * (0.6 + 0.8 * rand(i, 4)) * persp,
      z: (z + 1) / 2,
    });
  }
  return out;
}
