// Adobe/Resolve .cube colour lookup tables: parse 1D or 3D tables (with DOMAIN_MIN/MAX), and bring
// them to one 3D form: `size`³ RGB triples in 0..1, red fastest, then green, then blue.

export interface Lut3d {
  size: number;
  /** size³ × 3 values, index ((b · size + g) · size + r) · 3. */
  data: Float32Array;
}

export class CubeError extends Error {}

/** Largest 3D table kept (bigger ones are resampled down; 33³ is the common "high quality" size). */
export const MAX_LUT_SIZE = 33;

export function parseCube(text: string): Lut3d {
  let size3 = 0;
  let size1 = 0;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const parts = line.split(/\s+/);
    const key = parts[0].toUpperCase();
    if (key === 'LUT_3D_SIZE') size3 = Number(parts[1]);
    else if (key === 'LUT_1D_SIZE') size1 = Number(parts[1]);
    else if (key === 'DOMAIN_MIN') min = parts.slice(1, 4).map(Number);
    else if (key === 'DOMAIN_MAX') max = parts.slice(1, 4).map(Number);
    // Resolve's form of the domain: one range for all three channels.
    else if (key === 'LUT_3D_INPUT_RANGE' || key === 'LUT_1D_INPUT_RANGE') {
      min = [0, 1, 2].map(() => Number(parts[1]));
      max = [0, 1, 2].map(() => Number(parts[2]));
    }
    else if (key === 'TITLE' || key.startsWith('LUT_') || /^[A-Z_]+$/.test(key)) continue;
    else {
      const [r, g, b] = parts.slice(0, 3).map(Number);
      if (![r, g, b].every(Number.isFinite)) throw new CubeError(`not a number: ${line}`);
      values.push(r, g, b);
    }
  }
  if (size3 >= 2) {
    if (values.length !== size3 ** 3 * 3) throw new CubeError(`expected ${size3 ** 3} entries, found ${values.length / 3}`);
    const lut = { size: size3, data: Float32Array.from(values) };
    return resample(lut, Math.min(size3, MAX_LUT_SIZE), min, max);
  }
  if (size1 >= 2) {
    if (values.length !== size1 * 3) throw new CubeError(`expected ${size1} entries, found ${values.length / 3}`);
    return from1d(Float32Array.from(values), size1, min, max);
  }
  throw new CubeError('no LUT_3D_SIZE or LUT_1D_SIZE');
}

/** Trilinear lookup in a 3D table for an input already in the table's 0..1 domain. */
export function sample3d(lut: Lut3d, r: number, g: number, b: number): [number, number, number] {
  const n = lut.size;
  const p = [r, g, b].map((v) => Math.min(1, Math.max(0, v)) * (n - 1));
  const i0 = p.map(Math.floor);
  const i1 = i0.map((v) => Math.min(n - 1, v + 1));
  const f = p.map((v, k) => v - i0[k]);
  const at = (ri: number, gi: number, bi: number, c: number) => lut.data[((bi * n + gi) * n + ri) * 3 + c];
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const c00 = at(i0[0], i0[1], i0[2], c) * (1 - f[0]) + at(i1[0], i0[1], i0[2], c) * f[0];
    const c10 = at(i0[0], i1[1], i0[2], c) * (1 - f[0]) + at(i1[0], i1[1], i0[2], c) * f[0];
    const c01 = at(i0[0], i0[1], i1[2], c) * (1 - f[0]) + at(i1[0], i0[1], i1[2], c) * f[0];
    const c11 = at(i0[0], i1[1], i1[2], c) * (1 - f[0]) + at(i1[0], i1[1], i1[2], c) * f[0];
    out[c] = (c00 * (1 - f[1]) + c10 * f[1]) * (1 - f[2]) + (c01 * (1 - f[1]) + c11 * f[1]) * f[2];
  }
  return out;
}

/** A 3D table of `size` built from a colour function on 0..1 RGB. */
export function lutFrom(size: number, fn: (r: number, g: number, b: number) => [number, number, number]): Lut3d {
  const data = new Float32Array(size ** 3 * 3);
  let i = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        const [x, y, z] = fn(r / (size - 1), g / (size - 1), b / (size - 1));
        data[i++] = x;
        data[i++] = y;
        data[i++] = z;
      }
  return { size, data };
}

/** Resample to `size` over 0..1 input, mapping it into the table's domain [min, max]. */
function resample(lut: Lut3d, size: number, min: number[], max: number[]): Lut3d {
  const identityDomain = min.every((v) => v === 0) && max.every((v) => v === 1);
  if (size === lut.size && identityDomain) return lut;
  const toDomain = (v: number, c: number) => (v - min[c]) / (max[c] - min[c] || 1);
  return lutFrom(size, (r, g, b) => sample3d(lut, toDomain(r, 0), toDomain(g, 1), toDomain(b, 2)));
}

function from1d(values: Float32Array, n: number, min: number[], max: number[]): Lut3d {
  const curve = (v: number, c: number) => {
    const x = Math.min(1, Math.max(0, (v - min[c]) / (max[c] - min[c] || 1))) * (n - 1);
    const i = Math.floor(x);
    const j = Math.min(n - 1, i + 1);
    return values[i * 3 + c] + (values[j * 3 + c] - values[i * 3 + c]) * (x - i);
  };
  return lutFrom(Math.min(MAX_LUT_SIZE, 17), (r, g, b) => [curve(r, 0), curve(g, 1), curve(b, 2)]);
}

/** Write a table as .cube text (for the built-in pack and tests). */
export function formatCube(lut: Lut3d, title: string): string {
  const lines = [`TITLE "${title}"`, `LUT_3D_SIZE ${lut.size}`];
  for (let i = 0; i < lut.data.length; i += 3) lines.push(`${lut.data[i].toFixed(6)} ${lut.data[i + 1].toFixed(6)} ${lut.data[i + 2].toFixed(6)}`);
  return `${lines.join('\n')}\n`;
}
