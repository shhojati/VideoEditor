// LUTs in a project: imported .cube files and the built-in pack, stored as 8-bit RGB tables (base64)
// so the export worker gets them with the project. The built-in pack is generated here from simple
// colour maths (no third-party files).
import { lutFrom, type Lut3d } from '../lib/cube';
import type { ProjectLut } from './types';

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Store a table: values to bytes, base64. */
export function encodeLut(name: string, lut: Lut3d): ProjectLut {
  const bytes = Uint8Array.from(lut.data, (v) => Math.round(clamp01(v) * 255));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { name, size: lut.size, data: btoa(bin) };
}

const textures = new WeakMap<ProjectLut, Uint8Array>();

/**
 * The table as an RGBA texture: size² × size texels, blue slices side by side (texel x = r + b·size,
 * y = g), sampled trilinearly by the LUT3D shader.
 */
export function lutTexture(lut: ProjectLut): Uint8Array {
  let tex = textures.get(lut);
  if (!tex) {
    const bin = atob(lut.data);
    const n = lut.size;
    tex = new Uint8Array(n * n * n * 4);
    for (let b = 0; b < n; b++)
      for (let g = 0; g < n; g++)
        for (let r = 0; r < n; r++) {
          const src = ((b * n + g) * n + r) * 3;
          const dst = (g * n * n + b * n + r) * 4;
          tex[dst] = bin.charCodeAt(src);
          tex[dst + 1] = bin.charCodeAt(src + 1);
          tex[dst + 2] = bin.charCodeAt(src + 2);
          tex[dst + 3] = 255;
        }
    textures.set(lut, tex);
  }
  return tex;
}

// ---- built-in pack -------------------------------------------------------------------------------

type Rgb = [number, number, number];
const luma = (c: Rgb) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const mixRgb = (a: Rgb, b: Rgb, f: number): Rgb => [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
const saturate = (c: Rgb, s: number): Rgb => {
  const l = luma(c);
  return mixRgb([l, l, l], c, s);
};
/** S-curve around 0.5 (k > 1 adds contrast). */
const contrast = (v: number, k: number) => clamp01(0.5 + (v - 0.5) * k - (k - 1) * 0.5 * (v - 0.5) * Math.abs(v - 0.5) * 2);
const curve = (c: Rgb, k: number): Rgb => [contrast(c[0], k), contrast(c[1], k), contrast(c[2], k)];
const tone = (c: Rgb, lift: number, gain: number): Rgb => c.map((v) => lift + v * (gain - lift)) as Rgb;
const smooth = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export const BUILTIN_LUTS = {
  tealOrange: (c: Rgb): Rgb => {
    const l = luma(c);
    const warm = mixRgb(c, [c[0] * 1.12, c[1] * 1.0, c[2] * 0.84], smooth(0.35, 0.85, l));
    return curve(mixRgb(warm, [warm[0] * 0.85, warm[1] * 1.03, warm[2] * 1.12], (1 - l) ** 2), 1.12);
  },
  goldenHour: (c: Rgb): Rgb => saturate(tone([c[0] * 1.1, c[1] * 1.0, c[2] * 0.8], 0.03, 1), 1.12),
  coolNight: (c: Rgb): Rgb => saturate([c[0] * 0.82, c[1] * 0.94, c[2] * 1.12].map((v) => v ** 1.2) as Rgb, 0.8),
  bleachBypass: (c: Rgb): Rgb => curve(saturate(c, 0.45), 1.35),
  fadedFilm: (c: Rgb): Rgb => tone(saturate([c[0] * 1.03, c[1], c[2] * 0.96], 0.82), 0.08, 0.92),
  vintage: (c: Rgb): Rgb => {
    const l = luma(c);
    return tone(mixRgb(c, [l * 1.07, l * 0.95, l * 0.78], 0.4), 0.06, 0.94);
  },
  noir: (c: Rgb): Rgb => {
    const l = contrast(luma(c), 1.6);
    return [l, l, l];
  },
  sepia: (c: Rgb): Rgb => [
    0.393 * c[0] + 0.769 * c[1] + 0.189 * c[2],
    0.349 * c[0] + 0.686 * c[1] + 0.168 * c[2],
    0.272 * c[0] + 0.534 * c[1] + 0.131 * c[2],
  ],
  crossProcess: (c: Rgb): Rgb => [contrast(c[0], 1.4), c[1] ** 0.85, 0.22 + c[2] * 0.56],
  pastel: (c: Rgb): Rgb => tone(saturate(c, 0.7), 0.12, 1),
  highContrast: (c: Rgb): Rgb => saturate(curve(c, 1.5), 1.2),
  moody: (c: Rgb): Rgb => {
    const l = luma(c);
    return curve(mixRgb(saturate(c, 0.75), [c[0] * 0.9, c[1] * 1.0, c[2] * 0.97], (1 - l) ** 1.5), 1.15).map((v) => clamp01(v - 0.03)) as Rgb;
  },
} satisfies Record<string, (c: Rgb) => Rgb>;

export type BuiltinLutId = keyof typeof BUILTIN_LUTS;
export const BUILTIN_LUT_IDS = Object.keys(BUILTIN_LUTS) as BuiltinLutId[];
/** Key of a built-in LUT in Project.luts (the same in every project). */
export const builtinLutKey = (id: BuiltinLutId) => `builtin:${id}`;
const BUILTIN_SIZE = 33;

const builtins = new Map<BuiltinLutId, ProjectLut>();

/** A built-in LUT as stored in a project (made once per session). */
export function builtinLut(id: BuiltinLutId): ProjectLut {
  let lut = builtins.get(id);
  if (!lut) {
    const fn = BUILTIN_LUTS[id];
    lut = encodeLut(id, lutFrom(BUILTIN_SIZE, (r, g, b) => fn([r, g, b]).map(clamp01) as Rgb));
    builtins.set(id, lut);
  }
  return lut;
}
