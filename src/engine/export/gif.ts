// Animated GIF encoder: per-frame 256-colour palette (median cut over a 15-bit histogram),
// Floyd–Steinberg dithering, GIF LZW. Every frame is a full frame with its own local palette, and
// the animation loops forever.

export type GifSink = (data: Uint8Array) => Promise<void> | void;

const BINS = 1 << 15;
const binOf = (r: number, g: number, b: number) => ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);

interface Box {
  bins: number[];
  count: number;
}

/**
 * Up to `maxColors` representative colours of an RGBA image (alpha ignored), as RGB triplets.
 * Median cut on a 5-bit-per-channel histogram, each colour the weighted mean of its box.
 */
export function buildPalette(rgba: Uint8Array | Uint8ClampedArray, maxColors = 256): Uint8Array {
  const count = new Uint32Array(BINS);
  const sum = new Float64Array(BINS * 3);
  for (let i = 0; i < rgba.length; i += 4) {
    const k = binOf(rgba[i], rgba[i + 1], rgba[i + 2]);
    count[k]++;
    sum[k * 3] += rgba[i];
    sum[k * 3 + 1] += rgba[i + 1];
    sum[k * 3 + 2] += rgba[i + 2];
  }
  const used: number[] = [];
  for (let k = 0; k < BINS; k++) if (count[k]) used.push(k);
  const axis = (k: number, a: number) => (k >> (10 - a * 5)) & 31;
  const range = (box: Box) => {
    let best = 0;
    let bestRange = -1;
    for (let a = 0; a < 3; a++) {
      let lo = 31;
      let hi = 0;
      for (const k of box.bins) {
        const v = axis(k, a);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      if (hi - lo > bestRange) {
        bestRange = hi - lo;
        best = a;
      }
    }
    return { axis: best, range: bestRange };
  };
  const boxes: Box[] = [{ bins: used, count: used.reduce((n, k) => n + count[k], 0) }];
  while (boxes.length < maxColors) {
    // Split the box with the most pixels × widest spread.
    let pick = -1;
    let score = 0;
    let pickAxis = 0;
    for (let i = 0; i < boxes.length; i++) {
      if (boxes[i].bins.length < 2) continue;
      const r = range(boxes[i]);
      const s = boxes[i].count * (r.range + 1);
      if (s > score) {
        score = s;
        pick = i;
        pickAxis = r.axis;
      }
    }
    if (pick < 0) break;
    const box = boxes[pick];
    box.bins.sort((a, b) => axis(a, pickAxis) - axis(b, pickAxis));
    let acc = 0;
    let cut = 1;
    for (; cut < box.bins.length - 1; cut++) {
      acc += count[box.bins[cut - 1]];
      if (acc >= box.count / 2) break;
    }
    const left = box.bins.slice(0, cut);
    const right = box.bins.slice(cut);
    const n = (bins: number[]) => bins.reduce((m, k) => m + count[k], 0);
    boxes.splice(pick, 1, { bins: left, count: n(left) }, { bins: right, count: n(right) });
  }
  const palette = new Uint8Array(Math.max(1, boxes.length) * 3);
  boxes.forEach((box, i) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const k of box.bins) {
      r += sum[k * 3];
      g += sum[k * 3 + 1];
      b += sum[k * 3 + 2];
    }
    const c = Math.max(1, box.count);
    palette[i * 3] = Math.round(r / c);
    palette[i * 3 + 1] = Math.round(g / c);
    palette[i * 3 + 2] = Math.round(b / c);
  });
  return palette;
}

/** Palette index per pixel, with Floyd–Steinberg error diffusion. */
export function ditherToPalette(
  rgba: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  palette: Uint8Array,
): Uint8Array {
  const out = new Uint8Array(width * height);
  const colors = palette.length / 3;
  // Nearest palette entry per 15-bit colour, filled on first use.
  const nearest = new Int16Array(BINS).fill(-1);
  const lookup = (r: number, g: number, b: number) => {
    const k = binOf(r, g, b);
    let hit = nearest[k];
    if (hit < 0) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < colors; i++) {
        const dr = palette[i * 3] - r;
        const dg = palette[i * 3 + 1] - g;
        const db = palette[i * 3 + 2] - b;
        const d = dr * dr + dg * dg + db * db;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      hit = nearest[k] = best;
    }
    return hit;
  };
  let cur = new Float32Array((width + 2) * 3);
  let next = new Float32Array((width + 2) * 3);
  const clamp = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = (y * width + x) * 4;
      const e = (x + 1) * 3;
      const r = clamp(rgba[p] + cur[e]);
      const g = clamp(rgba[p + 1] + cur[e + 1]);
      const b = clamp(rgba[p + 2] + cur[e + 2]);
      const idx = lookup(r | 0, g | 0, b | 0);
      out[y * width + x] = idx;
      const er = r - palette[idx * 3];
      const eg = g - palette[idx * 3 + 1];
      const eb = b - palette[idx * 3 + 2];
      // 7/16 right, 3/16 down-left, 5/16 down, 1/16 down-right.
      cur[e + 3] += (er * 7) / 16;
      cur[e + 4] += (eg * 7) / 16;
      cur[e + 5] += (eb * 7) / 16;
      next[e - 3] += (er * 3) / 16;
      next[e - 2] += (eg * 3) / 16;
      next[e - 1] += (eb * 3) / 16;
      next[e] += (er * 5) / 16;
      next[e + 1] += (eg * 5) / 16;
      next[e + 2] += (eb * 5) / 16;
      next[e + 3] += er / 16;
      next[e + 4] += eg / 16;
      next[e + 5] += eb / 16;
    }
    [cur, next] = [next, cur];
    next.fill(0);
  }
  return out;
}

/** GIF LZW of palette indices, packed into 255-byte sub-blocks (with the 0 terminator). */
export function lzwEncode(indices: Uint8Array, minCodeSize: number): Uint8Array {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  const bytes: number[] = [];
  let acc = 0;
  let bits = 0;
  let codeSize = minCodeSize + 1;
  const emit = (code: number) => {
    acc |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      bytes.push(acc & 0xff);
      acc >>>= 8;
      bits -= 8;
    }
  };
  // Dictionary keyed by (prefix code << 8 | index); a generation stamp clears it in O(1).
  const stamps = lzwStamps();
  const codes = lzwCodes();
  let gen = ++lzwGeneration;
  let next = eoi + 1;
  emit(clear);
  if (indices.length) {
    let prefix = indices[0];
    for (let i = 1; i < indices.length; i++) {
      const k = indices[i];
      const key = (prefix << 8) | k;
      if (stamps[key] === gen) {
        prefix = codes[key];
        continue;
      }
      emit(prefix);
      if (next === 4096) {
        emit(clear);
        next = eoi + 1;
        codeSize = minCodeSize + 1;
        gen = ++lzwGeneration;
      } else {
        if (next >= 1 << codeSize) codeSize++;
        stamps[key] = gen;
        codes[key] = next++;
      }
      prefix = k;
    }
    emit(prefix);
  }
  emit(eoi);
  if (bits > 0) bytes.push(acc & 0xff);
  const blocks = Math.ceil(bytes.length / 255);
  const out = new Uint8Array(bytes.length + blocks + 1);
  let o = 0;
  for (let i = 0; i < bytes.length; i += 255) {
    const n = Math.min(255, bytes.length - i);
    out[o++] = n;
    for (let j = 0; j < n; j++) out[o++] = bytes[i + j];
  }
  out[o] = 0;
  return out;
}

let lzwGeneration = 0;
let stampTable: Int32Array | null = null;
let codeTable: Uint16Array | null = null;
const lzwStamps = () => (stampTable ??= new Int32Array(1 << 20));
const lzwCodes = () => (codeTable ??= new Uint16Array(1 << 20));

/** Centiseconds per frame, rounded so the total stays in step with the frame rate. */
export function gifDelay(frame: number, fps: number) {
  return Math.round(((frame + 1) * 100) / fps) - Math.round((frame * 100) / fps);
}

export class GifWriter {
  constructor(
    private readonly sink: GifSink,
    private readonly width: number,
    private readonly height: number,
  ) {}

  async start() {
    const h = new Uint8Array(13 + 19);
    h.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]); // GIF89a
    h[6] = this.width & 0xff;
    h[7] = this.width >> 8;
    h[8] = this.height & 0xff;
    h[9] = this.height >> 8;
    h[10] = 0x70; // no global colour table, 8-bit colour resolution
    // NETSCAPE2.0 application extension: loop forever.
    h.set(
      [0x21, 0xff, 0x0b, ...Array.from('NETSCAPE2.0', (c) => c.charCodeAt(0)), 0x03, 0x01, 0x00, 0x00, 0x00],
      13,
    );
    await this.sink(h);
  }

  /** One full frame (RGBA, width × height) shown for `delay` centiseconds. */
  async addFrame(rgba: Uint8Array | Uint8ClampedArray, delay: number) {
    const palette = buildPalette(rgba);
    const indices = ditherToPalette(rgba, this.width, this.height, palette);
    const colors = palette.length / 3;
    let sizeBits = 1;
    while (1 << sizeBits < colors) sizeBits++;
    const table = new Uint8Array(3 << sizeBits);
    table.set(palette);
    const head = new Uint8Array(8 + 10);
    // Graphic control: disposal "leave in place", no transparency.
    head.set([0x21, 0xf9, 0x04, 0x04, delay & 0xff, (delay >> 8) & 0xff, 0x00, 0x00]);
    head.set(
      [
        0x2c,
        0,
        0,
        0,
        0,
        this.width & 0xff,
        this.width >> 8,
        this.height & 0xff,
        this.height >> 8,
        0x80 | (sizeBits - 1),
      ],
      8,
    );
    await this.sink(head);
    await this.sink(table);
    const minCodeSize = Math.max(2, sizeBits);
    await this.sink(Uint8Array.of(minCodeSize));
    await this.sink(lzwEncode(indices, minCodeSize));
  }

  async finish() {
    await this.sink(Uint8Array.of(0x3b));
  }
}
