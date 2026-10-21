/// <reference lib="webworker" />
// Export pipeline (plan §4.5). For every output frame: decode the exact source frames (sequentially,
// never dropping), draw with the same renderFrame as the preview, encode H.264. Audio is mixed
// offline and encoded AAC, fed in step with video so the muxer interleaves without buffering the
// whole file. Output streams to a file handle when given one, otherwise into memory.
import {
  ALL_FORMATS,
  AudioSample,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  StreamTarget,
  VideoSampleSink,
  canEncodeAudio,
  type VideoSample,
} from 'mediabunny';
import { ensureAacEncoder, type AacSource } from '../engine/export/aac';
import { audibleClips, limit, mixClip, type DecodedRange } from '../engine/export/audioMix';
import { audioEnvelope } from '../engine/fade';
import { AUDIO_BITRATE, AUDIO_RATE, frameCount, outputSize, videoBitrate, type ExportSettings } from '../engine/export/settings';
import { MediaReader } from '../engine/decode/mediaReader';
import { frameSourceTime, renderFrame, sourceTimeAt, visualClipsAt, type Drawable } from '../engine/render/renderFrame';
import { clipVisibleRange } from '../model/transitions';
import { isOverlay } from '../model/overlays';
import { ensureFont } from '../lib/fonts';
import { getMediaFile } from '../lib/opfs';
import { timelineDuration } from '../model/timeline';
import type { Clip, ID, Project } from '../model/types';

export type ExportRequest =
  | { type: 'start'; project: Project; settings: ExportSettings; file?: FileSystemFileHandle }
  | { type: 'cancel' };

export type ExportMessage =
  | { type: 'progress'; phase: 'audio' | 'video'; done: number; total: number }
  | { type: 'done'; blob?: Blob; bytes: number; ms: number; audioCodec: string | null; aacSource: AacSource | null; width: number; height: number }
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

async function mixAudio(project: Project, duration: number): Promise<[Float32Array, Float32Array] | null> {
  const clips = audibleClips(project);
  if (!clips.length) return null;
  const n = Math.ceil(duration * AUDIO_RATE);
  const mix: [Float32Array, Float32Array] = [new Float32Array(n), new Float32Array(n)];
  for (const [i, { clip, track, opfsPath }] of clips.entries()) {
    // Transitions extend a clip's audible range (crossfades) past its own edges.
    const env = audioEnvelope(clip, track, (c) => (c.assetId ? project.assets[c.assetId]?.duration : undefined));
    const range = await decodeRange(opfsPath, Math.max(0, sourceTimeAt(clip, env.start)), sourceTimeAt(clip, env.end));
    if (range) mixClip(mix, AUDIO_RATE, clip, range, env);
    post({ type: 'progress', phase: 'audio', done: i + 1, total: clips.length });
  }
  limit(mix);
  return mix;
}

// ---- main ----

async function run(project: Project, settings: ExportSettings, file?: FileSystemFileHandle) {
  const t0 = performance.now();
  const duration = timelineDuration(project);
  if (duration <= 0) throw new Error('The timeline is empty.');
  const { width, height } = outputSize(project.settings, settings.resolution);
  const fps = settings.fps;
  const frames = frameCount(duration, fps);

  // Fonts used by text and burned-in subtitles must be loaded in this worker before drawing.
  const fonts = new Set<string>();
  for (const t of project.tracks) for (const c of t.clips) if (c.text) fonts.add(`${c.text.fontFamily}|${c.text.fontWeight}`);
  if (settings.burnSubtitles)
    for (const st of project.subtitleTracks) if (!st.hidden) fonts.add(`${st.style.fontFamily}|${st.style.fontWeight ?? 600}`);
  await Promise.all([...fonts].map((f) => ensureFont(f.split('|')[0], Number(f.split('|')[1]))));

  const audio = await mixAudio(project, duration);
  checkCancel();
  // AAC from the browser, or the bundled WASM encoder; Opus only if even that fails to load.
  let aacSource: AacSource | null = null;
  if (audio) aacSource = await ensureAacEncoder().catch(() => null);
  const audioCodec = !audio ? null : (await canEncodeAudio('aac')) ? 'aac' : (await canEncodeAudio('opus')) ? 'opus' : null;

  const writable = file ? await file.createWritable() : null;
  const target = writable ? new StreamTarget(writable, { chunked: true }) : new BufferTarget();
  const output = new Output({ format: new Mp4OutputFormat({ fastStart: writable ? false : 'in-memory' }), target });
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { alpha: false })!;
  const video = new CanvasSource(canvas, {
    codec: 'avc',
    bitrate: videoBitrate(width, height, fps, settings.quality),
    keyFrameInterval: 2,
  });
  output.addVideoTrack(video, { frameRate: fps });
  const audioSource = audio && audioCodec ? new AudioSampleSource({ codec: audioCodec, bitrate: AUDIO_BITRATE }) : null;
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();

  // Visual sources.
  const streams = new Map<ID, ExactClipFrames>();
  const images = new Map<ID, MediaReader | null>();
  const held = new Map<ID, Drawable>();
  const lookup = (clip: Clip) => held.get(clip.id);

  const AUDIO_CHUNK = AUDIO_RATE; // 1 s per AudioSample
  let audioPos = 0;
  const feedAudioUntil = async (t: number) => {
    if (!audio || !audioSource) return;
    const until = Math.min(audio[0].length, Math.ceil(t * AUDIO_RATE));
    while (audioPos < until) {
      const n = Math.min(AUDIO_CHUNK, audio[0].length - audioPos);
      const data = new Float32Array(n * 2);
      data.set(audio[0].subarray(audioPos, audioPos + n), 0);
      data.set(audio[1].subarray(audioPos, audioPos + n), n);
      const sample = new AudioSample({ data, format: 'f32-planar', numberOfChannels: 2, sampleRate: AUDIO_RATE, timestamp: audioPos / AUDIO_RATE });
      await audioSource.add(sample);
      sample.close();
      audioPos += n;
    }
  };

  try {
    for (let i = 0; i < frames; i++) {
      checkCancel();
      const t = i / fps;
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
      ctx.setTransform(width / project.settings.width, 0, 0, height / project.settings.height, 0, 0);
      renderFrame(project, t, ctx, lookup, { subtitles: settings.burnSubtitles });
      await feedAudioUntil(t + 1 / fps + 0.5);
      await video.add(t, 1 / fps); // awaits encoder/writer backpressure
      if (i % 10 === 0 || i === frames - 1) post({ type: 'progress', phase: 'video', done: i + 1, total: frames });
    }
    await feedAudioUntil(duration);
    await output.finalize();
  } catch (e) {
    await output.cancel().catch(() => {});
    throw e;
  } finally {
    for (const s of streams.values()) s.close();
  }

  const blob = target instanceof BufferTarget ? new Blob([target.buffer!], { type: 'video/mp4' }) : undefined;
  const bytes = blob?.size ?? (await file!.getFile()).size;
  post({ type: 'done', blob, bytes, ms: performance.now() - t0, audioCodec, aacSource: audioCodec === 'aac' ? aacSource : null, width, height });
}

self.onmessage = async (e: MessageEvent<ExportRequest>) => {
  if (e.data.type === 'cancel') {
    cancelled = true;
    return;
  }
  cancelled = false;
  try {
    await run(e.data.project, e.data.settings, e.data.file);
  } catch (err) {
    if (err instanceof Cancelled) post({ type: 'cancelled' });
    else post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  } finally {
    for (const p of inputs.values()) void p.then((i) => i.dispose()).catch(() => {});
    inputs.clear();
  }
};
