/// <reference lib="webworker" />
// Export pipeline (plan §4.5). For every output frame: decode the exact source frames (sequentially,
// never dropping), draw with the same renderFrame as the preview, then encode for the chosen format:
// MP4/MOV/WebM/MP3 through Mediabunny, AVI through our own muxer, GIF through our own encoder,
// PNG/JPG as one image or a ZIP of every frame. Audio is mixed offline and fed in step with video so
// the muxer interleaves without buffering the whole file. Output streams to a file handle when given
// one, otherwise into memory.
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  MovOutputFormat,
  Mp3OutputFormat,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  VideoSampleSink,
  WebMOutputFormat,
  canEncodeAudio,
  canEncodeVideo,
  type AudioCodec,
  type VideoCodec,
  type VideoSample,
} from 'mediabunny';
import { ensureAacEncoder, type AacSource } from '../engine/export/aac';
import { audibleClips, limit, mixClip, type DecodedRange } from '../engine/export/audioMix';
import { AviWriter, pcm16, type ByteSink } from '../engine/export/avi';
import { GifWriter, gifDelay } from '../engine/export/gif';
import { audioEnvelope } from '../engine/fade';
import {
  AUDIO_RATE,
  FORMATS,
  effectiveVideoBitrate,
  fitToFormat,
  frameCount,
  hasAudio,
  outputMime,
  outputSize,
  type ExportSettings,
} from '../engine/export/settings';
import { MediaReader } from '../engine/decode/mediaReader';
import {
  frameSourceTime,
  renderFrame,
  sourceTimeAt,
  visualClipsAt,
  type Drawable,
} from '../engine/render/renderFrame';
import { drawWatermark, type WatermarkSpec } from '../engine/render/watermark';
import { clipVisibleRange } from '../model/transitions';
import { isOverlay } from '../model/overlays';
import { ensureFont } from '../lib/fonts';
import { getMediaFile } from '../lib/opfs';
import { ZipWriter } from '../lib/zip';
import { timelineDuration } from '../model/timeline';
import type { ID, Project } from '../model/types';
import type { AudioAux } from '../engine/audio/audioAux';
import { sourceRangeFor } from '../model/remap';

export type ExportRequest =
  | {
      type: 'start';
      project: Project;
      settings: ExportSettings;
      file?: FileSystemFileHandle;
      /** Free plan (features/account/policy.ts). */
      watermark?: WatermarkSpec;
      /** Duck plan and noise profiles, made on the main thread (engine/audio/audioAux.ts). */
      aux?: AudioAux;
    }
  | { type: 'cancel' };

export type ExportMessage =
  | { type: 'progress'; phase: 'audio' | 'video' | 'encode'; done: number; total: number }
  | {
      type: 'done';
      blob?: Blob;
      bytes: number;
      ms: number;
      audioCodec: string | null;
      aacSource: AacSource | null;
      videoCodec: string | null;
      width: number;
      height: number;
    }
  | { type: 'cancelled' }
  | { type: 'error'; message: string };

const post = (m: ExportMessage) => self.postMessage(m);
let cancelled = false;

class Cancelled extends Error {}
const checkCancel = () => {
  if (cancelled) throw new Cancelled();
};

// ---- inputs ----

const inputs = new Map<string, Promise<Input>>();
function openInput(opfsPath: string) {
  let p = inputs.get(opfsPath);
  if (!p) {
    p = getMediaFile(opfsPath).then((f) => {
      if (!f) throw new Error(`Media file missing: ${opfsPath}`);
      return new Input({ source: new BlobSource(f), formats: ALL_FORMATS });
    });
    inputs.set(opfsPath, p);
  }
  return p;
}

/** Sequential, exact frame source for one clip: always returns the frame covering the asked time. */
class ExactClipFrames {
  private it: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private cur: VideoSample | null = null;
  private next: VideoSample | null = null;
  private done = false;

  constructor(
    private readonly opfsPath: string,
    /** Last source time needed (extended for an outgoing transition). */
    private readonly srcEnd: number,
  ) {}

  async at(srcTime: number): Promise<VideoSample | null> {
    if (!this.it) {
      const track = await (await openInput(this.opfsPath)).getPrimaryVideoTrack();
      if (!track) return null;
      this.it = new VideoSampleSink(track).samples(srcTime, this.srcEnd + 1e-3);
      this.cur = (await this.it.next()).value ?? null;
      this.next = (await this.it.next()).value ?? null;
    }
    // Advance while the following frame already starts at or before the requested time.
    while (this.next && this.next.timestamp <= srcTime + 1e-6) {
      this.cur?.close();
      this.cur = this.next;
      const r = this.done ? undefined : await this.it.next();
      this.next = r && !r.done ? r.value : null;
      if (!this.next) this.done = true;
    }
    return this.cur;
  }

  close() {
    this.cur?.close();
    this.next?.close();
    void this.it?.return(undefined);
  }
}

// ---- audio ----

async function decodeRange(opfsPath: string, from: number, to: number): Promise<DecodedRange | null> {
  const track = await (await openInput(opfsPath)).getPrimaryAudioTrack();
  if (!track) return null;
  const parts: Float32Array[][] = [];
  let start = -1;
  let rate = 0;
  let channels = 0;
  for await (const s of new AudioSampleSink(track).samples(from, to)) {
    if (start < 0) {
      start = s.timestamp;
      rate = s.sampleRate;
      channels = Math.min(2, s.numberOfChannels);
    }
    const planes = Array.from({ length: channels }, (_, c) => {
      const buf = new Float32Array(s.numberOfFrames);
      s.copyTo(buf, { planeIndex: c, format: 'f32-planar' });
      return buf;
    });
    parts.push(planes);
    s.close();
    checkCancel();
  }
  if (start < 0) return null;
  const total = parts.reduce((n, p) => n + p[0].length, 0);
  const out = Array.from({ length: channels }, () => new Float32Array(total));
  let o = 0;
  for (const p of parts) {
    p.forEach((plane, c) => out[c].set(plane, o));
    o += p[0].length;
  }
  return { channels: out, rate, start };
}

async function mixAudio(project: Project, duration: number, aux: AudioAux): Promise<[Float32Array, Float32Array] | null> {
  const clips = audibleClips(project);
  if (!clips.length) return null;
  const n = Math.ceil(duration * AUDIO_RATE);
  const mix: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  for (const [i, { clip, track, opfsPath }] of clips.entries()) {
    // Transitions extend a clip's audible range (crossfades) past its own edges.
    const env = audioEnvelope(
      clip,
      track,
      (c) => (c.assetId ? project.assets[c.assetId]?.duration : undefined),
      aux.duck?.[clip.id],
    );
    const { from, to } = sourceRangeFor(clip, env.start, env.end);
    const range = await decodeRange(opfsPath, Math.max(0, from), to);
    if (range) mixClip(mix, AUDIO_RATE, clip, range, env, clip.assetId ? aux.noise?.[clip.assetId] : undefined);
    post({ type: 'progress', phase: 'audio', done: i + 1, total: clips.length });
  }
  limit(mix);
  return mix;
}

// ---- output ----

/** Where the file bytes go: the chosen file (streamed) or memory. `position` rewrites earlier bytes. */
class Sink implements ByteSink {
  private readonly parts: (Uint8Array | Blob)[] = [];
  private readonly offsets: number[] = [];
  bytes = 0;

  constructor(
    private readonly writable: FileSystemWritableFileStream | null,
    private readonly mime: string,
  ) {}

  async write(data: Uint8Array | Blob, position?: number) {
    const size = data instanceof Blob ? data.size : data.byteLength;
    if (this.writable) {
      await this.writable.write(
        position === undefined ? (data as BlobPart) : { type: 'write', position, data: data as BlobPart },
      );
    } else if (position !== undefined) {
      // In memory only whole earlier parts are rewritten (the AVI header).
      const i = this.offsets.indexOf(position);
      const old = this.parts[i];
      if (i < 0 || (old instanceof Blob ? old.size : old.byteLength) !== size)
        throw new Error('Unsupported rewrite');
      this.parts[i] = data;
    } else {
      this.parts.push(data);
      this.offsets.push(this.bytes);
    }
    if (position === undefined) this.bytes += size;
  }

  /** Close the file, or return the in-memory result. */
  async close(): Promise<Blob | undefined> {
    if (this.writable) {
      await this.writable.close();
      return undefined;
    }
    return new Blob(this.parts as BlobPart[], { type: this.mime });
  }

  async abort() {
    await this.writable?.abort().catch(() => {});
  }
}

/** Draws the timeline at increasing times; decodes exact source frames as needed. */
class FrameRenderer {
  private readonly streams = new Map<ID, ExactClipFrames>();
  private readonly images = new Map<ID, MediaReader | null>();
  private readonly held = new Map<ID, Drawable>();

  constructor(
    private readonly project: Project,
    private readonly ctx: OffscreenCanvasRenderingContext2D,
    private readonly width: number,
    private readonly height: number,
    private readonly subtitles: boolean,
    private readonly watermark?: WatermarkSpec,
  ) {}

  async draw(t: number) {
    const { project, streams, images, held } = this;
    const active = visualClipsAt(project, t).filter(({ clip }) => !isOverlay(clip));
    const activeIds = new Set(active.map(({ clip }) => clip.id));
    // Close sources of clips that have ended.
    for (const [id, s] of streams) {
      if (activeIds.has(id)) continue;
      s.close();
      streams.delete(id);
    }
    held.clear();
    for (const { clip, track } of active) {
      const asset = clip.assetId ? project.assets[clip.assetId] : undefined;
      if (!asset?.fileRef.opfsPath) continue;
      if (asset.kind === 'image') {
        if (!images.has(asset.id)) images.set(asset.id, await MediaReader.open(asset));
        const img = images.get(asset.id)?.imageAt(sourceTimeAt(clip, t));
        if (img) held.set(clip.id, img);
      } else if (asset.kind === 'video') {
        let s = streams.get(clip.id);
        if (!s) {
          const srcEnd = frameSourceTime(clip, clipVisibleRange(track, clip).end, asset.duration);
          streams.set(clip.id, (s = new ExactClipFrames(asset.fileRef.opfsPath, srcEnd)));
        }
        const frame = await s.at(frameSourceTime(clip, t, asset.duration));
        if (frame) held.set(clip.id, frame);
      }
    }
    this.ctx.setTransform(
      this.width / project.settings.width,
      0,
      0,
      this.height / project.settings.height,
      0,
      0,
    );
    renderFrame(project, t, this.ctx, (clip) => held.get(clip.id), { subtitles: this.subtitles });
    if (this.watermark) drawWatermark(this.ctx, this.watermark, this.width, this.height);
  }

  close() {
    for (const s of this.streams.values()) s.close();
    this.streams.clear();
  }
}

interface Job {
  project: Project;
  settings: ExportSettings;
  duration: number;
  width: number;
  height: number;
  sink: Sink;
  watermark?: WatermarkSpec;
}

interface Encoded {
  audioCodec: string | null;
  aacSource: AacSource | null;
  videoCodec: string | null;
}

/** Calls `each` for every output frame after drawing it; reports progress. */
async function renderAll(job: Job, renderer: FrameRenderer, each: (t: number, i: number) => Promise<void>) {
  const fps = job.settings.fps;
  const frames = frameCount(job.duration, fps);
  for (let i = 0; i < frames; i++) {
    checkCancel();
    const t = i / fps;
    await renderer.draw(t);
    await each(t, i);
    if (i % 10 === 0 || i === frames - 1)
      post({ type: 'progress', phase: 'video', done: i + 1, total: frames });
  }
}

/** Feeds the mix to an AudioSampleSource in 1 s samples, up to a time. */
function audioFeeder(audio: [Float32Array, Float32Array] | null, source: AudioSampleSource | null) {
  let pos = 0;
  return async (t: number, onProgress?: (done: number, total: number) => void) => {
    if (!audio || !source) return;
    const until = Math.min(audio[0].length, Math.ceil(t * AUDIO_RATE));
    while (pos < until) {
      checkCancel();
      const n = Math.min(AUDIO_RATE, audio[0].length - pos);
      const data = new Float32Array(n * 2);
      data.set(audio[0].subarray(pos, pos + n), 0);
      data.set(audio[1].subarray(pos, pos + n), n);
      const sample = new AudioSample({
        data,
        format: 'f32-planar',
        numberOfChannels: 2,
        sampleRate: AUDIO_RATE,
        timestamp: pos / AUDIO_RATE,
      });
      await source.add(sample);
      sample.close();
      pos += n;
      onProgress?.(pos, audio[0].length);
    }
  };
}

/** MP4, MOV, WebM and MP3 through Mediabunny. */
async function encodeWithMediabunny(
  job: Job,
  audio: [Float32Array, Float32Array] | null,
  writable: FileSystemWritableFileStream | null,
): Promise<Encoded> {
  const { settings, width, height, duration } = job;
  const fps = settings.fps;
  const fastStart = writable ? false : 'in-memory';
  const format =
    settings.format === 'mov'
      ? new MovOutputFormat({ fastStart })
      : settings.format === 'webm'
        ? new WebMOutputFormat()
        : settings.format === 'mp3'
          ? new Mp3OutputFormat()
          : new Mp4OutputFormat({ fastStart });

  // Audio codec per container. AAC from the browser or the bundled WASM encoder; LAME for MP3.
  let aacSource: AacSource | null = null;
  let audioCodec: AudioCodec | null = null;
  if (audio && settings.format === 'mp3') {
    await ensureMp3Encoder();
    audioCodec = 'mp3';
  } else if (audio && settings.format === 'webm') {
    if (!(await canEncodeAudio('opus'))) throw new Error('This browser cannot encode Opus audio for WebM.');
    audioCodec = 'opus';
  } else if (audio) {
    aacSource = await ensureAacEncoder().catch(() => null);
    if (await canEncodeAudio('aac')) audioCodec = 'aac';
    // Without AAC: Opus in MP4 (some players fail), uncompressed PCM in MOV.
    else if (settings.format === 'mov') audioCodec = 'pcm-s16';
    else if (await canEncodeAudio('opus')) audioCodec = 'opus';
  }
  if (settings.format === 'mp3' && !audioCodec) throw new Error('The timeline has no audio to export.');

  const target = writable ? new StreamTarget(writable, { chunked: true }) : new BufferTarget();
  const output = new Output({ format, target });
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  let videoCodec: VideoCodec | null = null;
  let video: CanvasSource | null = null;
  if (settings.format !== 'mp3') {
    const bitrate = effectiveVideoBitrate(settings, width, height);
    videoCodec =
      settings.format !== 'webm'
        ? 'avc'
        : (await canEncodeVideo('vp9', { width, height, bitrate }))
          ? 'vp9'
          : 'vp8';
    video = new CanvasSource(canvas, { codec: videoCodec, bitrate, keyFrameInterval: 2 });
    output.addVideoTrack(video, { frameRate: fps });
  }
  const audioSource = audioCodec
    ? new AudioSampleSource(
        audioCodec.startsWith('pcm')
          ? { codec: audioCodec }
          : { codec: audioCodec, bitrate: settings.audioBitrate },
      )
    : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();
  const feed = audioFeeder(audio, audioSource);

  const renderer = new FrameRenderer(job.project, ctx, width, height, settings.burnSubtitles, job.watermark);
  try {
    if (video) {
      const v = video;
      await renderAll(job, renderer, async (t) => {
        await feed(t + 1 / fps + 0.5);
        await v.add(t, 1 / fps); // awaits encoder/writer backpressure
      });
    }
    await feed(duration, (done, total) => {
      if (!video) post({ type: 'progress', phase: 'encode', done, total });
    });
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    renderer.close();
  }
  if (target instanceof BufferTarget) await job.sink.write(new Uint8Array(target.buffer!));
  return { audioCodec, aacSource: audioCodec === 'aac' ? aacSource : null, videoCodec };
}

async function ensureMp3Encoder() {
  if (await canEncodeAudio('mp3')) return;
  const { registerMp3Encoder } = await import('@mediabunny/mp3-encoder');
  registerMp3Encoder();
}

/** First H.264 profile/level the browser's encoder accepts for this size, Annex B output. */
async function avcConfig(
  width: number,
  height: number,
  bitrate: number,
  fps: number,
): Promise<VideoEncoderConfig> {
  for (const codec of [
    'avc1.640033',
    'avc1.640028',
    'avc1.4d0033',
    'avc1.4d0028',
    'avc1.42e033',
    'avc1.42e028',
  ]) {
    const config: VideoEncoderConfig = {
      codec,
      width,
      height,
      bitrate,
      framerate: fps,
      avc: { format: 'annexb' },
    };
    if ((await VideoEncoder.isConfigSupported(config).catch(() => null))?.supported) return config;
  }
  throw new Error('This browser cannot encode H.264 at this size.');
}

/** AVI: H.264 from WebCodecs (Annex B) and 16-bit PCM, muxed by our own AviWriter. */
async function encodeAvi(job: Job, audio: [Float32Array, Float32Array] | null): Promise<Encoded> {
  const { settings, width, height, duration } = job;
  const fps = settings.fps;
  const avi = new AviWriter(job.sink, {
    width,
    height,
    fps,
    audio: audio ? { sampleRate: AUDIO_RATE, channels: 2 } : undefined,
  });
  await avi.start();
  const config = await avcConfig(width, height, effectiveVideoBitrate(settings, width, height), fps);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false })!;

  // Each encoded frame is written with the audio of its frame period in front of it.
  let failure: unknown = null;
  let written = Promise.resolve();
  let frameIndex = 0;
  let audioPos = 0;
  const audioUntil = (end: number) => {
    if (!audio) return;
    const to = Math.min(audio[0].length, end);
    if (to <= audioPos) return;
    const pcm = pcm16(audio[0], audio[1], audioPos, to);
    audioPos = to;
    return avi.addAudio(pcm);
  };
  const encoder = new VideoEncoder({
    output: (chunk) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      const key = chunk.type === 'key';
      const end = Math.round(((frameIndex + 1) * AUDIO_RATE) / fps);
      frameIndex++;
      written = written
        .then(async () => {
          await audioUntil(end);
          await avi.addVideo(data, key);
        })
        .catch((e) => {
          failure ??= e;
        });
    },
    error: (e) => {
      failure ??= e;
    },
  });
  encoder.configure(config);
  const renderer = new FrameRenderer(job.project, ctx, width, height, settings.burnSubtitles, job.watermark);
  try {
    await renderAll(job, renderer, async (t, i) => {
      if (failure) throw failure;
      const frame = new VideoFrame(canvas, {
        timestamp: Math.round(t * 1e6),
        duration: Math.round(1e6 / fps),
      });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      while (encoder.encodeQueueSize > 4)
        await new Promise((r) => encoder.addEventListener('dequeue', r, { once: true }));
      if (i % 8 === 0) await written;
    });
    await encoder.flush();
    await written;
    if (failure) throw failure;
    await audioUntil(Math.ceil(duration * AUDIO_RATE));
    await avi.finish();
  } finally {
    renderer.close();
    if (encoder.state !== 'closed') encoder.close();
  }
  return { audioCodec: audio ? 'pcm-s16' : null, aacSource: null, videoCodec: 'avc' };
}

async function encodeGif(job: Job) {
  const { settings, width, height } = job;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true })!;
  const gif = new GifWriter((b) => job.sink.write(b), width, height);
  await gif.start();
  const renderer = new FrameRenderer(job.project, ctx, width, height, settings.burnSubtitles, job.watermark);
  try {
    await renderAll(job, renderer, async (_t, i) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      await gif.addFrame(ctx.getImageData(0, 0, width, height).data, gifDelay(i, settings.fps));
    });
    await gif.finish();
  } finally {
    renderer.close();
  }
}

/** PNG/JPG: the frame at `frameTime`, or every frame in a ZIP. */
async function encodeImages(job: Job) {
  const { settings, width, height, duration } = job;
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const type = FORMATS[settings.format].mime;
  const image = () => canvas.convertToBlob(type === 'image/jpeg' ? { type, quality: 0.92 } : { type });
  const renderer = new FrameRenderer(job.project, ctx, width, height, settings.burnSubtitles, job.watermark);
  try {
    if (settings.imageMode === 'frame') {
      // The last frame starts one frame before the end.
      await renderer.draw(
        Math.min(Math.max(0, settings.frameTime), Math.max(0, duration - 1 / settings.fps)),
      );
      await job.sink.write(await image());
      return;
    }
    const zip = new ZipWriter((part) => job.sink.write(part));
    const digits = Math.max(4, String(frameCount(duration, settings.fps)).length);
    await renderAll(job, renderer, async (_t, i) => {
      await zip.add(
        `frame_${String(i + 1).padStart(digits, '0')}.${FORMATS[settings.format].ext}`,
        await image(),
      );
    });
    await zip.finish();
  } finally {
    renderer.close();
  }
}

// ---- main ----

async function run(
  project: Project,
  input: ExportSettings,
  file?: FileSystemFileHandle,
  watermark?: WatermarkSpec,
  aux: AudioAux = {},
) {
  const t0 = performance.now();
  const settings = fitToFormat(input);
  const duration = timelineDuration(project);
  if (duration <= 0) throw new Error('The timeline is empty.');
  const { width, height } = outputSize(project.settings, settings.resolution);

  // Fonts used by text and burned-in subtitles must be loaded in this worker before drawing.
  const fonts = new Set<string>();
  for (const t of project.tracks)
    for (const c of t.clips) if (c.text) fonts.add(`${c.text.fontFamily}|${c.text.fontWeight}`);
  if (settings.burnSubtitles)
    for (const st of project.subtitleTracks)
      if (!st.hidden) fonts.add(`${st.style.fontFamily}|${st.style.fontWeight ?? 600}`);
  if (watermark && !watermark.image) fonts.add(`${watermark.config.fontFamily}|${watermark.config.fontWeight}`);
  if (settings.format !== 'mp3')
    await Promise.all([...fonts].map((f) => ensureFont(f.split('|')[0], Number(f.split('|')[1]))));

  const audio = hasAudio(settings) ? await mixAudio(project, duration, aux) : null;
  checkCancel();

  const writable = file ? await file.createWritable() : null;
  const sink = new Sink(writable, outputMime(settings));
  const job: Job = { project, settings, duration, width, height, sink, watermark };
  // Mediabunny writes a chosen file through its own StreamTarget, which closes the stream.
  const viaMediabunny =
    settings.format !== 'avi' &&
    (FORMATS[settings.format].kind === 'video' || FORMATS[settings.format].kind === 'audio');
  let encoded: Encoded = { audioCodec: null, aacSource: null, videoCodec: null };
  try {
    if (settings.format === 'avi') encoded = await encodeAvi(job, audio);
    else if (viaMediabunny) encoded = await encodeWithMediabunny(job, audio, writable);
    else if (settings.format === 'gif') await encodeGif(job);
    else await encodeImages(job);
  } catch (e) {
    if (!viaMediabunny) await sink.abort();
    throw e;
  }
  const blob = viaMediabunny && writable ? undefined : await sink.close();
  const bytes = blob?.size ?? (await file!.getFile()).size;
  post({ type: 'done', blob, bytes, ms: performance.now() - t0, ...encoded, width, height });
}

self.onmessage = async (e: MessageEvent<ExportRequest>) => {
  if (e.data.type === 'cancel') {
    cancelled = true;
    return;
  }
  cancelled = false;
  try {
    await run(e.data.project, e.data.settings, e.data.file, e.data.watermark, e.data.aux);
  } catch (err) {
    if (err instanceof Cancelled) post({ type: 'cancelled' });
    else post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  } finally {
    for (const p of inputs.values()) void p.then((i) => i.dispose()).catch(() => {});
    inputs.clear();
  }
};
