import { describe, expect, it } from 'vitest';
import { AviTooLargeError, AviWriter, pcm16, type ByteSink } from './avi';
import { buildPalette, ditherToPalette, gifDelay, GifWriter, lzwEncode } from './gif';
import {
  effectiveAudioBitrate,
  effectiveVideoBitrate,
  estimateBytes,
  fitToFormat,
  outputMime,
  outputName,
  PCM_BITRATE,
  videoBitrate,
  type ExportSettings,
} from './settings';

const base: ExportSettings = {
  format: 'mp4',
  resolution: 1080,
  fps: 30,
  quality: 'medium',
  videoBitrate: 5_000_000,
  audioBitrate: 160_000,
  imageMode: 'frame',
  frameTime: 0,
  burnSubtitles: true,
  srt: false,
};

describe('export formats', () => {
  it('clamps resolution and fps to what the format offers', () => {
    expect(fitToFormat({ ...base, format: 'gif' })).toMatchObject({ resolution: 480, fps: 24 });
    expect(fitToFormat({ ...base, format: 'gif', fps: 10, resolution: 240 })).toMatchObject({
      resolution: 240,
      fps: 10,
    });
    expect(fitToFormat({ ...base, format: 'mov', resolution: 480, fps: 15 })).toMatchObject({
      resolution: 720,
      fps: 24,
    });
  });

  it('names files and types per format; image sequences are ZIPs', () => {
    expect(outputName('a', { ...base, format: 'mov' })).toBe('a.mov');
    expect(outputMime({ ...base, format: 'avi' })).toBe('video/x-msvideo');
    expect(outputName('a', { ...base, format: 'png' })).toBe('a.png');
    expect(outputName('a', { ...base, format: 'jpg', imageMode: 'sequence' })).toBe('a.zip');
  });

  it('uses the typed bitrate only for custom quality; AVI audio is PCM', () => {
    expect(effectiveVideoBitrate(base, 1920, 1080)).toBe(videoBitrate(1920, 1080, 30, 'medium'));
    expect(effectiveVideoBitrate({ ...base, quality: 'custom' }, 1920, 1080)).toBe(5_000_000);
    expect(effectiveAudioBitrate({ ...base, format: 'avi' })).toBe(PCM_BITRATE);
    expect(effectiveAudioBitrate({ ...base, format: 'gif' })).toBe(0);
    expect(estimateBytes({ ...base, format: 'mp3' }, 10, 0, 0)).toBe(200_000);
    expect(estimateBytes({ ...base, quality: 'custom' }, 8, 1920, 1080)).toBe(
      ((5_000_000 + 160_000) / 8) * 8,
    );
  });
});

/** Collects writes like a file: positioned writes overwrite. */
function memorySink() {
  let buf = new Uint8Array(0);
  const sink: ByteSink = {
    async write(data, position) {
      const at = position ?? buf.length;
      if (at + data.length > buf.length) {
        const grown = new Uint8Array(at + data.length);
        grown.set(buf);
        buf = grown;
      }
      buf.set(data, at);
    },
  };
  return { sink, bytes: () => buf };
}

const fourcc = (b: Uint8Array, at: number) => String.fromCharCode(...b.subarray(at, at + 4));

describe('AviWriter', () => {
  it('writes a RIFF AVI with patched totals, interleaved chunks and an idx1 index', async () => {
    const { sink, bytes } = memorySink();
    const avi = new AviWriter(sink, {
      width: 640,
      height: 360,
      fps: 25,
      audio: { sampleRate: 48_000, channels: 2 },
    });
    await avi.start();
    await avi.addAudio(new Uint8Array(1920 * 4));
    await avi.addVideo(Uint8Array.of(0, 0, 0, 1, 0x65, 1, 2), true); // odd length: padded
    await avi.addAudio(new Uint8Array(1920 * 4));
    await avi.addVideo(Uint8Array.of(0, 0, 0, 1, 0x41, 9), false);
    const size = await avi.finish();
    const b = bytes();
    const v = new DataView(b.buffer);
    expect(size).toBe(b.length);
    expect(fourcc(b, 0)).toBe('RIFF');
    expect(v.getUint32(4, true)).toBe(b.length - 8);
    expect(fourcc(b, 8)).toBe('AVI ');
    expect(fourcc(b, 12)).toBe('LIST');
    expect(fourcc(b, 20)).toBe('hdrl');
    expect(fourcc(b, 24)).toBe('avih');
    expect(v.getUint32(32, true)).toBe(40_000); // µs per frame at 25 fps
    expect(v.getUint32(48, true)).toBe(2); // total frames
    expect(v.getUint32(56, true)).toBe(2); // streams
    expect([v.getUint32(64, true), v.getUint32(68, true)]).toEqual([640, 360]);

    // Walk to 'movi' and its chunks.
    const hdrlEnd = 20 + v.getUint32(16, true);
    expect(fourcc(b, hdrlEnd)).toBe('LIST');
    const moviSize = v.getUint32(hdrlEnd + 4, true);
    const movi = hdrlEnd + 8;
    expect(fourcc(b, movi)).toBe('movi');
    const ids: string[] = [];
    let at = movi + 4;
    while (at < movi + moviSize) {
      ids.push(fourcc(b, at));
      const n = v.getUint32(at + 4, true);
      at += 8 + n + (n & 1);
    }
    expect(at).toBe(movi + moviSize);
    expect(ids).toEqual(['01wb', '00dc', '01wb', '00dc']);
    expect(fourcc(b, at)).toBe('idx1');
    expect(v.getUint32(at + 4, true)).toBe(4 * 16);
    // Entry 2 is the key frame: flag set, offset counted from the 'movi' id.
    const e = at + 8 + 16;
    expect(fourcc(b, e)).toBe('00dc');
    expect(v.getUint32(e + 4, true)).toBe(0x10);
    expect(fourcc(b, movi + v.getUint32(e + 8, true))).toBe('00dc');
    expect(v.getUint32(e + 12, true)).toBe(7);
    expect(v.getUint32(at + 8 + 48 + 4, true)).toBe(0); // the delta frame
    // Audio stream length in sample frames.
    const auds = Array.from({ length: hdrlEnd }, (_, i) => i).find((i) => fourcc(b, i) === 'auds')!;
    expect(v.getUint32(auds + 32, true)).toBe(3840);
  });

  it('writes a video-only file without an audio stream', async () => {
    const { sink, bytes } = memorySink();
    const avi = new AviWriter(sink, { width: 2, height: 2, fps: 30 });
    await avi.start();
    await avi.addVideo(new Uint8Array(4), true);
    await avi.finish();
    expect(new DataView(bytes().buffer).getUint32(56, true)).toBe(1);
    await expect(avi.addAudio(new Uint8Array(4))).rejects.toThrow();
  });

  it('refuses to grow past 4 GB', async () => {
    const avi = new AviWriter({ write: async () => {} }, { width: 2, height: 2, fps: 30 });
    await avi.start();
    const big = { length: 0xffff_ff00 } as Uint8Array;
    await expect(avi.addVideo(big, true)).rejects.toBeInstanceOf(AviTooLargeError);
  });

  it('converts float stereo to interleaved s16le with clipping', () => {
    const out = new DataView(pcm16(Float32Array.of(0, 1, 2), Float32Array.of(-1, 0.5, -2), 0, 3).buffer);
    expect([0, 1, 2, 3, 4, 5].map((i) => out.getInt16(i * 2, true))).toEqual([
      0, -32767, 32767, 16384, 32767, -32768,
    ]);
  });
});

/** Reference GIF LZW decoder (sub-blocks already joined). */
function lzwDecode(data: Uint8Array, minCodeSize: number, count: number): number[] {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let size = minCodeSize + 1;
  let dict: number[][] = [];
  const reset = () => {
    dict = Array.from({ length: clear + 2 }, (_, i) => [i]);
    size = minCodeSize + 1;
  };
  reset();
  const out: number[] = [];
  let bitPos = 0;
  let prev: number[] | null = null;
  while (out.length <= count) {
    let code = 0;
    for (let i = 0; i < size; i++, bitPos++) code |= ((data[bitPos >> 3] >> (bitPos & 7)) & 1) << i;
    if (code === clear) {
      reset();
      prev = null;
      continue;
    }
    if (code === eoi) break;
    const entry: number[] = code < dict.length ? dict[code] : [...prev!, prev![0]];
    out.push(...entry);
    if (prev && dict.length < 4096) dict.push([...prev, entry[0]]);
    if (dict.length === 1 << size && size < 12) size++;
    prev = entry;
  }
  return out;
}

const unblock = (b: Uint8Array) => {
  const out: number[] = [];
  let i = 0;
  while (b[i]) {
    out.push(...b.subarray(i + 1, i + 1 + b[i]));
    i += b[i] + 1;
  }
  expect(i).toBe(b.length - 1);
  return Uint8Array.from(out);
};

describe('GIF encoder', () => {
  it('LZW round-trips, including dictionary resets', () => {
    const noisy = Uint8Array.from({ length: 50_000 }, (_, i) => (i * 7919 + (i >> 3)) & 255);
    expect(lzwDecode(unblock(lzwEncode(noisy, 8)), 8, noisy.length)).toEqual(Array.from(noisy));
    const runs = Uint8Array.from({ length: 10_000 }, (_, i) => (i >> 6) & 3);
    expect(lzwDecode(unblock(lzwEncode(runs, 2)), 2, runs.length)).toEqual(Array.from(runs));
  });

  it('keeps exact colours when there are few, and caps the palette at 256', () => {
    const rgba = new Uint8Array(4 * 4);
    rgba.set([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 0, 0, 255]);
    const palette = buildPalette(rgba);
    expect(palette.length).toBe(9);
    const idx = ditherToPalette(rgba, 4, 1, palette);
    expect(Array.from(idx, (i) => Array.from(palette.subarray(i * 3, i * 3 + 3)))).toEqual([
      [255, 0, 0],
      [0, 255, 0],
      [0, 0, 255],
      [255, 0, 0],
    ]);
    const gradient = Uint8Array.from({ length: 64 * 64 * 4 }, (_, i) => {
      const [p, c] = [i >> 2, i & 3];
      return c === 3 ? 255 : c === 0 ? (p & 63) * 4 : c === 1 ? (p >> 6) * 4 : (p * 37) & 255;
    });
    expect(buildPalette(gradient).length).toBe(256 * 3);
  });

  it('frame delays add up to the duration', () => {
    const d = Array.from({ length: 15 }, (_, i) => gifDelay(i, 15));
    expect(d.reduce((a, b) => a + b)).toBe(100);
    expect(new Set(d)).toEqual(new Set([6, 7]));
  });

  it('writes header, loop extension, frames with local palettes and the trailer', async () => {
    const parts: Uint8Array[] = [];
    const gif = new GifWriter((b) => void parts.push(b), 2, 2);
    await gif.start();
    await gif.addFrame(new Uint8Array(16).fill(255), 7);
    await gif.finish();
    const b = Uint8Array.from(parts.flatMap((p) => Array.from(p)));
    expect(String.fromCharCode(...b.subarray(0, 6))).toBe('GIF89a');
    expect(String.fromCharCode(...b.subarray(16, 27))).toBe('NETSCAPE2.0');
    expect(Array.from(b.subarray(32, 38))).toEqual([0x21, 0xf9, 0x04, 0x04, 7, 0]);
    expect(b[40]).toBe(0x2c);
    expect(b[b.length - 1]).toBe(0x3b);
  });
});
