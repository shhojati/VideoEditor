// Per-clip blend modes (After Effects' set). A blended clip is drawn into a transparent layer the
// size of the target canvas (same transform), then the layer is composited onto the frame in one
// go, so the clip blends as a whole like a layer (its own fill, stroke and box do not blend with
// each other). The composite goes through the target's current state, so transition alpha, clip
// regions and blur still apply.
//
// Modes the canvas has natively are composited by the browser. The rest are computed per pixel:
// the layer's colours are replaced by the blend result B(backdrop, source) and the layer is then
// drawn normally, which gives backdrop·(1−a) + B·a — the blend at the layer's opacity.
import type { BlendMode } from '../../model/types';
import type { Ctx2D } from './renderFrame';

const NATIVE: Partial<Record<BlendMode, GlobalCompositeOperation>> = {
  normal: 'source-over',
  darken: 'darken',
  multiply: 'multiply',
  colorBurn: 'color-burn',
  add: 'lighter',
  linearDodge: 'lighter', // identical to Add at 8 bits per channel, as in After Effects
  lighten: 'lighten',
  screen: 'screen',
  colorDodge: 'color-dodge',
  overlay: 'overlay',
  softLight: 'soft-light',
  hardLight: 'hard-light',
  difference: 'difference',
  classicDifference: 'difference', // the same |a − b| at 8 bits per channel
  exclusion: 'exclusion',
  hue: 'hue',
  saturation: 'saturation',
  color: 'color',
  luminosity: 'luminosity',
};

/** True for modes computed per pixel in JavaScript (slower: the frame is read back). */
export const isPixelBlend = (mode: BlendMode) => !NATIVE[mode];

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/**
 * Per-channel blend functions on 0..1 values: a = backdrop, b = source (the clip). The "classic"
 * burn/dodge are the older formulas without the special cases for black/white backdrops.
 */
const burn = (a: number, b: number) => (b <= 0 ? 0 : 1 - Math.min(1, (1 - a) / b));
const dodge = (a: number, b: number) => (b >= 1 ? 1 : Math.min(1, a / (1 - b)));
export const SEPARABLE: Partial<Record<BlendMode, (a: number, b: number) => number>> = {
  classicColorBurn: burn,
  linearBurn: (a, b) => a + b - 1,
  classicColorDodge: dodge,
  linearLight: (a, b) => a + 2 * b - 1,
  vividLight: (a, b) => (b < 0.5 ? burn(a, 2 * b) : dodge(a, 2 * (b - 0.5))),
  pinLight: (a, b) => (b < 0.5 ? Math.min(a, 2 * b) : Math.max(a, 2 * b - 1)),
  hardMix: (a, b) => (a + b >= 1 ? 1 : 0),
  subtract: (a, b) => a - b,
  divide: (a, b) => (b <= 0 ? 1 : a / b),
};

/** 256×256 lookup table per separable mode: index backdrop·256 + source. */
const luts = new Map<BlendMode, Uint8Array>();
function lutFor(mode: BlendMode): Uint8Array {
  let lut = luts.get(mode);
  if (!lut) {
    const f = SEPARABLE[mode]!;
    lut = new Uint8Array(65536);
    for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) lut[a * 256 + b] = clamp255(f(a / 255, b / 255) * 255);
    luts.set(mode, lut);
  }
  return lut;
}

type Canvas = OffscreenCanvas;
const pool: Canvas[] = [];

/** Layer canvases are reused between frames (one per nesting level). */
function layer(level: number, w: number, h: number) {
  let c = pool[level];
  if (!c) c = pool[level] = new OffscreenCanvas(w, h);
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, w, h);
  return { canvas: c, ctx };
}

let depth = 0;

export interface BlendOptions {
  /** Picks the dissolve pattern (stable per clip, or per frame for Dancing Dissolve). */
  seed?: number;
  /** Runs on the layer after drawing, before compositing (effects). Forces the layer path. */
  post?: (layer: OffscreenCanvas) => void;
  /** Extra opacity for the composite (adjustment layers). */
  alpha?: number;
}

/**
 * Draw with `draw(layerCtx)` and blend the result onto `ctx` with `mode`. Normal mode without
 * `post` draws straight into `ctx`.
 */
export function drawBlended(ctx: Ctx2D, mode: BlendMode | undefined, draw: (c: Ctx2D) => void, opts: BlendOptions = {}) {
  const { seed = 0, post, alpha = 1 } = opts;
  mode ??= 'normal';
  if (mode === 'normal' && !post) {
    draw(ctx);
    return;
  }
  const { width, height } = ctx.canvas;
  const l = layer(depth, width, height);
  depth++;
  try {
    l.ctx.setTransform(ctx.getTransform());
    draw(l.ctx);
    post?.(l.canvas);
  } finally {
    depth--;
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha *= alpha;
  const native = NATIVE[mode];
  if (native) ctx.globalCompositeOperation = native;
  else {
    const src = l.ctx.getImageData(0, 0, width, height);
    if (mode === 'dissolve' || mode === 'dancingDissolve') dissolve(src.data, seed);
    else blendPixels(mode, src.data, ctx.getImageData(0, 0, width, height).data);
    l.ctx.putImageData(src, 0, 0);
  }
  ctx.drawImage(l.canvas, 0, 0);
  ctx.restore();
}

/** Rec. 601 luma (as used for Darker/Lighter Color), in integer weights summing to 256. */
const luma = (r: number, g: number, b: number) => 77 * r + 150 * g + 29 * b;

/**
 * Replace the source pixels' colours (RGBA, unpremultiplied, in place; alpha kept) by the blend
 * result against the backdrop `dst`.
 */
export function blendPixels(mode: BlendMode, src: Uint8ClampedArray, dst: Uint8ClampedArray) {
  if (mode === 'darkerColor' || mode === 'lighterColor') {
    // The whole pixel with the lower (higher) luma, unlike Darken/Lighten which go per channel.
    const darker = mode === 'darkerColor';
    for (let i = 0; i < src.length; i += 4) {
      if (src[i + 3] === 0) continue;
      const backdropWins = luma(dst[i], dst[i + 1], dst[i + 2]) < luma(src[i], src[i + 1], src[i + 2]) === darker;
      if (backdropWins) {
        src[i] = dst[i];
        src[i + 1] = dst[i + 1];
        src[i + 2] = dst[i + 2];
      }
    }
    return;
  }
  const lut = lutFor(mode);
  for (let i = 0; i < src.length; i += 4) {
    if (src[i + 3] === 0) continue;
    src[i] = lut[(dst[i] << 8) | src[i]];
    src[i + 1] = lut[(dst[i + 1] << 8) | src[i + 1]];
    src[i + 2] = lut[(dst[i + 2] << 8) | src[i + 2]];
  }
}

/** 0..1 pseudo-random value per pixel index and seed (integer hash, no state). */
function noise(i: number, seed: number) {
  let h = Math.imul(i ^ seed, 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca77);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/**
 * Dissolve: each pixel is either fully shown or not at all, with a probability equal to its
 * opacity (so a 50 % clip shows half its pixels, at full strength).
 */
export function dissolve(src: Uint8ClampedArray, seed: number) {
  for (let i = 3, p = 0; i < src.length; i += 4, p++) {
    const a = src[i];
    if (a === 0 || a === 255) continue;
    src[i] = noise(p, seed) * 255 < a ? 255 : 0;
  }
}

/** Stable seed from a string (the clip id). */
export function seedOf(id: string) {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return h >>> 0;
}
