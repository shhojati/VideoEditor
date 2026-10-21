// Animated images (GIF, animated PNG/WebP stickers): every frame is decoded once with WebCodecs'
// ImageDecoder (already composited, so GIF disposal is handled) and kept as an ImageBitmap. The
// animation loops; frameIndexAt picks the frame for a time.
import type { Drawable } from '../render/renderFrame';

/** More frames than this keeps only the first (a sticker this long is not worth the memory). */
const MAX_FRAMES = 600;
/** Browsers treat GIF delays under 20 ms as 100 ms; do the same. */
const MIN_DELAY_US = 20_000;
const DEFAULT_DELAY_US = 100_000;

export interface AnimatedImage {
  frames: ImageBitmap[];
  /** Start time of each frame and the loop length, in seconds. */
  starts: number[];
  duration: number;
}

/** Image type from the first bytes (OPFS files carry no MIME type). */
export async function sniffImageType(file: Blob): Promise<string | undefined> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return undefined;
}

/** Decode all frames, or null when the image is not animated (or ImageDecoder is unavailable). */
export async function decodeAnimated(file: Blob): Promise<AnimatedImage | null> {
  const type = await sniffImageType(file);
  if (!type || typeof ImageDecoder === 'undefined' || !(await ImageDecoder.isTypeSupported(type))) return null;
  const decoder = new ImageDecoder({ data: file.stream(), type });
  try {
    await decoder.tracks.ready;
    const track = decoder.tracks.selectedTrack;
    if (!track?.animated) return null;
    await decoder.completed;
    const count = track.frameCount;
    if (count < 2 || count > MAX_FRAMES) return null;
    const frames: ImageBitmap[] = [];
    const starts: number[] = [];
    let t = 0;
    for (let i = 0; i < count; i++) {
      const { image } = await decoder.decode({ frameIndex: i });
      starts.push(t);
      const d = image.duration ?? DEFAULT_DELAY_US;
      t += (d < MIN_DELAY_US ? DEFAULT_DELAY_US : d) / 1e6;
      frames.push(await createImageBitmap(image));
      image.close();
    }
    return { frames, starts, duration: t };
  } finally {
    decoder.close();
  }
}

/** Frame shown at time `t` (s) of a looping animation. Pure. */
export function frameIndexAt(starts: number[], duration: number, t: number): number {
  if (duration <= 0) return 0;
  let local = t % duration;
  if (local < 0) local += duration;
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    // Tolerance: starts are sums of delays, so an exact boundary may be off by rounding.
    if (starts[mid] <= local + 1e-9) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export const bitmapDrawable = (bmp: ImageBitmap): Drawable => ({
  displayWidth: bmp.width,
  displayHeight: bmp.height,
  draw: (ctx, dx, dy, dw, dh) => ctx.drawImage(bmp, dx, dy, dw, dh),
});
