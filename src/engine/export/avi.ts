// AVI (RIFF) muxer for H.264 video (Annex B, parameter sets in-band on key frames) and 16-bit PCM
// audio. Mediabunny has no AVI output, so this writes the classic AVI 1.0 layout: a header whose
// totals are patched at the end, 'movi' chunks in arrival order, and an idx1 index. AVI 1.0 offsets
// are 32-bit, so files are limited to 4 GB.

/** Receives the file bytes in order; `position` rewrites earlier bytes (only the header). */
export interface ByteSink {
  write(data: Uint8Array, position?: number): Promise<void>;
}

export interface AviOptions {
  width: number;
  height: number;
  fps: number;
  /** Interleaved s16le PCM; omit for a video-only file. */
  audio?: { sampleRate: number; channels: number };
}

export class AviTooLargeError extends Error {
  constructor() {
    super('The AVI file would be larger than 4 GB; lower the bitrate or use MP4.');
  }
}

const AVIF_HASINDEX = 0x10;
const AVIF_ISINTERLEAVED = 0x100;
const AVIIF_KEYFRAME = 0x10;
const MAX_SIZE = 0xffff_fff0;

class Builder {
  private readonly view: DataView;
  readonly buf: Uint8Array;
  private at = 0;
  constructor(size: number) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }
  cc(s: string) {
    for (let i = 0; i < 4; i++) this.buf[this.at++] = s.charCodeAt(i);
    return this;
  }
  u32(v: number) {
    this.view.setUint32(this.at, v >>> 0, true);
    this.at += 4;
    return this;
  }
  u16(v: number) {
    this.view.setUint16(this.at, v, true);
    this.at += 2;
    return this;
  }
  zeros(n: number) {
    this.at += n;
    return this;
  }
  get length() {
    return this.at;
  }
}

interface IndexEntry {
  id: string;
  flags: number;
  offset: number;
  size: number;
}

export class AviWriter {
  private readonly index: IndexEntry[] = [];
  private pos = 0;
  private headerLength = 0;
  private videoFrames = 0;
  private audioBytes = 0;
  private maxChunk = 0;

  constructor(
    private readonly sink: ByteSink,
    private readonly opts: AviOptions,
  ) {}

  private get blockAlign() {
    return (this.opts.audio?.channels ?? 2) * 2;
  }

  /** Header up to and including the 'movi' list id; same length whatever the totals. */
  private header(): Uint8Array {
    const { width, height, fps, audio } = this.opts;
    const streams = audio ? 2 : 1;
    const videoStrl = 4 + (8 + 56) + (8 + 40);
    const audioStrl = 4 + (8 + 56) + (8 + 18);
    const hdrl = 4 + (8 + 56) + (8 + videoStrl) + (audio ? 8 + audioStrl : 0);
    const total = 12 + 8 + hdrl + 12;
    const moviSize = this.pos - total + 4; // 'movi' id + chunks
    const riffSize = this.pos - 8;
    const b = new Builder(total);
    const bytesPerSec = Math.round(this.pos / Math.max(1e-3, this.videoFrames / fps));
    b.cc('RIFF').u32(riffSize).cc('AVI ');
    b.cc('LIST').u32(hdrl).cc('hdrl');
    b.cc('avih')
      .u32(56)
      .u32(Math.round(1e6 / fps)) // µs per frame
      .u32(bytesPerSec)
      .u32(0) // padding granularity
      .u32(AVIF_HASINDEX | AVIF_ISINTERLEAVED)
      .u32(this.videoFrames)
      .u32(0) // initial frames
      .u32(streams)
      .u32(this.maxChunk)
      .u32(width)
      .u32(height)
      .zeros(16);
    // Video stream.
    b.cc('LIST').u32(videoStrl).cc('strl');
    b.cc('strh')
      .u32(56)
      .cc('vids')
      .cc('H264')
      .u32(0) // flags
      .u16(0)
      .u16(0) // priority, language
      .u32(0) // initial frames
      .u32(1)
      .u32(fps) // scale, rate: fps frames per second
      .u32(0) // start
      .u32(this.videoFrames)
      .u32(this.maxChunk)
      .u32(0xffffffff) // quality: default
      .u32(0) // sample size: variable
      .u16(0)
      .u16(0)
      .u16(width)
      .u16(height); // rcFrame
    b.cc('strf')
      .u32(40) // BITMAPINFOHEADER
      .u32(40)
      .u32(width)
      .u32(height)
      .u16(1) // planes
      .u16(24) // bit count
      .cc('H264')
      .u32(width * height * 3)
      .u32(0)
      .u32(0)
      .u32(0)
      .u32(0);
    if (audio) {
      const align = this.blockAlign;
      b.cc('LIST').u32(audioStrl).cc('strl');
      b.cc('strh')
        .u32(56)
        .cc('auds')
        .u32(0)
        .u32(0)
        .u16(0)
        .u16(0)
        .u32(0)
        .u32(align)
        .u32(audio.sampleRate * align) // scale, rate: one block per sample frame
        .u32(0)
        .u32(this.audioBytes / align) // length in sample frames
        .u32(this.maxChunk)
        .u32(0xffffffff)
        .u32(align) // sample size
        .u16(0)
        .u16(0)
        .u16(0)
        .u16(0);
      b.cc('strf')
        .u32(18) // WAVEFORMATEX
        .u16(1) // PCM
        .u16(audio.channels)
        .u32(audio.sampleRate)
        .u32(audio.sampleRate * align)
        .u16(align)
        .u16(16)
        .u16(0);
    }
    b.cc('LIST').u32(moviSize).cc('movi');
    return b.buf;
  }

  async start() {
    const h = this.header();
    this.headerLength = h.length;
    await this.sink.write(h);
    this.pos = h.length;
  }

  private async chunk(id: string, data: Uint8Array, flags: number) {
    const padded = data.length + (data.length & 1);
    if (this.pos + 8 + padded + (this.index.length + 1) * 16 + 8 > MAX_SIZE) throw new AviTooLargeError();
    // Offsets in idx1 count from the 'movi' id.
    this.index.push({ id, flags, offset: this.pos - (this.headerLength - 4), size: data.length });
    const head = new Builder(8).cc(id).u32(data.length).buf;
    await this.sink.write(head);
    await this.sink.write(data);
    if (padded !== data.length) await this.sink.write(new Uint8Array(1));
    this.pos += 8 + padded;
    this.maxChunk = Math.max(this.maxChunk, data.length);
  }

  /** One encoded frame, in decode order. */
  async addVideo(data: Uint8Array, key: boolean) {
    await this.chunk('00dc', data, key ? AVIIF_KEYFRAME : 0);
    this.videoFrames++;
  }

  /** Interleaved s16le samples; a whole number of sample frames. */
  async addAudio(pcm: Uint8Array) {
    if (!this.opts.audio) throw new Error('This AVI has no audio stream.');
    if (!pcm.length) return;
    await this.chunk('01wb', pcm, AVIIF_KEYFRAME);
    this.audioBytes += pcm.length;
  }

  /** Write the index and the final header. Returns the file size. */
  async finish(): Promise<number> {
    const idx = new Builder(8 + this.index.length * 16).cc('idx1').u32(this.index.length * 16);
    for (const e of this.index) idx.cc(e.id).u32(e.flags).u32(e.offset).u32(e.size);
    await this.sink.write(idx.buf);
    this.pos += idx.length;
    // The movi list ends where idx1 starts.
    const moviEnd = this.pos - idx.length;
    const end = this.pos;
    this.pos = moviEnd;
    const header = this.header();
    this.pos = end;
    // RIFF size covers idx1 too.
    new DataView(header.buffer).setUint32(4, end - 8, true);
    await this.sink.write(header, 0);
    return end;
  }
}

/** Float planar stereo → interleaved s16le bytes. */
export function pcm16(left: Float32Array, right: Float32Array, from: number, to: number): Uint8Array {
  const n = Math.max(0, to - from);
  const out = new DataView(new ArrayBuffer(n * 4));
  const s16 = (x: number) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
  for (let i = 0; i < n; i++) {
    out.setInt16(i * 4, s16(left[from + i]), true);
    out.setInt16(i * 4 + 2, s16(right[from + i]), true);
  }
  return new Uint8Array(out.buffer);
}
