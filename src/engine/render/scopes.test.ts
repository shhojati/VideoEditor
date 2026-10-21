import { describe, expect, it } from 'vitest';
import { histogram, vectorscope, waveform } from './scopes';

/** w×h pixels of one colour. */
const solid = (w: number, h: number, [r, g, b]: number[]) => Uint8ClampedArray.from({ length: w * h * 4 }, (_, i) => [r, g, b, 255][i % 4]);

describe('scopes', () => {
  it('histogram counts each channel and luma', () => {
    const h = histogram(solid(4, 2, [255, 0, 128]));
    expect(h.r[255]).toBe(8);
    expect(h.g[0]).toBe(8);
    expect(h.b[128]).toBe(8);
    expect(h.l[Math.round(0.2126 * 255 + 0.0722 * 128)]).toBe(8);
  });

  it('waveform puts bright pixels at the top of their column', () => {
    const px = solid(2, 1, [0, 0, 0]);
    px.set([255, 255, 255, 255], 4); // right pixel white
    const w = waveform(px, 2, 1, 2, 4);
    expect(w[3 * 2 + 0]).toBe(1); // left: black, bottom row
    expect(w[0 * 2 + 1]).toBe(1); // right: white, top row
  });

  it('vectorscope centres grey and moves colours outwards', () => {
    const grey = vectorscope(solid(1, 1, [128, 128, 128]), 64);
    expect(grey[32 * 64 + 32]).toBe(1);
    const red = vectorscope(solid(1, 1, [255, 0, 0]), 64);
    const at = red.findIndex((v) => v > 0);
    // Red: Cr up (row above the centre), Cb a little left.
    expect(Math.floor(at / 64)).toBeLessThan(32);
    expect(at % 64).toBeLessThan(32);
  });
});
