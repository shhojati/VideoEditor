// Video scopes from RGBA pixels (the preview frame, downscaled): histogram, luma waveform and
// vectorscope. Counts only; features/preview/Scopes.tsx draws them.

const luma = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/** 256 bins per channel (and luma) of 8-bit RGBA pixels. */
export function histogram(px: Uint8ClampedArray) {
  const r = new Uint32Array(256);
  const g = new Uint32Array(256);
  const b = new Uint32Array(256);
  const l = new Uint32Array(256);
  for (let i = 0; i < px.length; i += 4) {
    r[px[i]]++;
    g[px[i + 1]]++;
    b[px[i + 2]]++;
    l[Math.round(luma(px[i], px[i + 1], px[i + 2]))]++;
  }
  return { r, g, b, l };
}

/**
 * Luma waveform: for every column of the image, how many pixels have each brightness. Out is
 * `outW × outH`, row 0 = brightest.
 */
export function waveform(px: Uint8ClampedArray, width: number, height: number, outW: number, outH: number): Uint32Array {
  const out = new Uint32Array(outW * outH);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const ox = Math.min(outW - 1, Math.floor((x * outW) / width));
      const oy = outH - 1 - Math.min(outH - 1, Math.floor((luma(px[i], px[i + 1], px[i + 2]) / 256) * outH));
      out[oy * outW + ox]++;
    }
  }
  return out;
}

/**
 * Vectorscope: pixels placed by chroma (Cb → x, Cr → up) on a `size × size` grid centred on grey;
 * the edge of the grid is full saturation.
 */
export function vectorscope(px: Uint8ClampedArray, size: number): Uint32Array {
  const out = new Uint32Array(size * size);
  const half = size / 2;
  for (let i = 0; i < px.length; i += 4) {
    const r = px[i] / 255;
    const g = px[i + 1] / 255;
    const b = px[i + 2] / 255;
    const cb = -0.1146 * r - 0.3854 * g + 0.5 * b;
    const cr = 0.5 * r - 0.4542 * g - 0.0458 * b;
    const x = Math.min(size - 1, Math.max(0, Math.floor(half + cb * size)));
    const y = Math.min(size - 1, Math.max(0, Math.floor(half - cr * size)));
    out[y * size + x]++;
  }
  return out;
}
