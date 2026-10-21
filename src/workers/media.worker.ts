/// <reference lib="webworker" />
// Heavy per-asset work off the main thread: filmstrip thumbnails and audio waveforms.
// Reads the original file straight from OPFS, so nothing large crosses postMessage.
import { ALL_FORMATS, AudioSampleSink, BlobSource, CanvasSink, Input } from 'mediabunny';
import { getMediaFile } from '../lib/opfs';
import { PeakBuilder } from '../lib/peaks';
import { BinAccumulator, STT_RATE } from '../engine/stt/audio16k';
import { LoudnessMeter, measureNoiseProfile } from '../engine/audio/cleanDsp';
import { exposeRpc } from './rpc';

const JPEG = { type: 'image/jpeg', quality: 0.72 } as const;

async function openFile(opfsPath: string) {
  const file = await getMediaFile(opfsPath);
  if (!file) throw new Error('missing');
  return file;
}

export interface ThumbsArgs {
  opfsPath: string;
  kind: 'video' | 'image';
  duration?: number;
  count: number;
  height: number;
}

async function thumbnails({ opfsPath, kind, duration = 0, count, height }: ThumbsArgs) {
  const file = await openFile(opfsPath);

  if (kind === 'image') {
    const bmp = await createImageBitmap(file, { resizeHeight: height, resizeQuality: 'medium' });
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0);
    bmp.close();
    const blob = await canvas.convertToBlob(JPEG);
    return { result: { times: [0], blobs: [blob], width: canvas.width, height: canvas.height } };
  }

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('no video track');
    const width = Math.max(1, Math.round((height * track.displayWidth) / track.displayHeight));
    const sink = new CanvasSink(track, { width, height, fit: 'fill', poolSize: 1 });
    // Sample the middle of each slot so the first thumbnail is rarely a black lead-in frame.
    const times = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * duration);
    const blobs: Blob[] = [];
    const kept: number[] = [];
    let i = 0;
    for await (const frame of sink.canvasesAtTimestamps(times)) {
      if (frame) {
        blobs.push(await (frame.canvas as OffscreenCanvas).convertToBlob(JPEG));
        kept.push(times[i]);
      }
      i++;
    }
    return { result: { times: kept, blobs, width, height } };
  } finally {
    input.dispose();
  }
}

export interface WaveformArgs {
  opfsPath: string;
  duration: number;
  peaksPerSecond: number;
}

async function waveform({ opfsPath, duration, peaksPerSecond }: WaveformArgs) {
  const file = await openFile(opfsPath);
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('no audio track');
    const builder = new PeakBuilder(duration, peaksPerSecond);
    let scratch: Float32Array[] = [];
    for await (const sample of new AudioSampleSink(track).samples()) {
      const n = sample.numberOfFrames;
      if (scratch.length !== sample.numberOfChannels || scratch[0].length !== n)
        scratch = Array.from({ length: sample.numberOfChannels }, () => new Float32Array(n));
      for (let c = 0; c < sample.numberOfChannels; c++) {
        sample.copyTo(scratch[c], { planeIndex: c, format: 'f32-planar' });
      }
      builder.push(scratch, sample.sampleRate, sample.timestamp);
      sample.close();
    }
    const peaks = builder.result();
    return { result: { peaks }, transfer: [peaks.buffer] };
  } finally {
    input.dispose();
  }
}

export interface MixItem {
  opfsPath: string;
  /** Timeline placement of the clip (s). */
  start: number;
  duration: number;
  inPoint: number;
  speed: number;
  gain: number;
}

/** Mix audible clips onto a 16 kHz mono timeline buffer (input for speech-to-text). */
async function mixdown16k({ items, duration }: { items: MixItem[]; duration: number }) {
  const mix = new Float32Array(Math.ceil(duration * STT_RATE));
  for (const item of items) {
    const file = await openFile(item.opfsPath);
    const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
    try {
      const track = await input.getPrimaryAudioTrack();
      if (!track) continue;
      const acc = new BinAccumulator(Math.floor(item.start * STT_RATE), Math.ceil(item.duration * STT_RATE) + 1);
      let scratch: Float32Array[] = [];
      const srcEnd = item.inPoint + item.duration * item.speed;
      for await (const sample of new AudioSampleSink(track).samples(item.inPoint, srcEnd)) {
        const n = sample.numberOfFrames;
        if (scratch.length !== sample.numberOfChannels || scratch[0].length !== n)
          scratch = Array.from({ length: sample.numberOfChannels }, () => new Float32Array(n));
        for (let c = 0; c < sample.numberOfChannels; c++) sample.copyTo(scratch[c], { planeIndex: c, format: 'f32-planar' });
        const t0 = sample.timestamp;
        const rate = sample.sampleRate;
        // Source time -> timeline time -> 16 kHz output position.
        acc.push(scratch, (i) => (item.start + (t0 + i / rate - item.inPoint) / item.speed) * STT_RATE);
        sample.close();
      }
      acc.addInto(mix, item.gain);
    } finally {
      input.dispose();
    }
  }
  return { result: { pcm: mix }, transfer: [mix.buffer] };
}

/** Seconds of audio the noise profile looks at (enough to find the quiet parts of long files). */
const PROFILE_SECONDS = 180;

/** Background noise spectrum of an asset (first channel), for noise reduction. */
async function noiseProfile({ opfsPath }: { opfsPath: string }) {
  const file = await openFile(opfsPath);
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('no audio track');
    const parts: Float32Array[] = [];
    let rate = 48_000;
    let total = 0;
    for await (const sample of new AudioSampleSink(track).samples(0, PROFILE_SECONDS)) {
      const buf = new Float32Array(sample.numberOfFrames);
      sample.copyTo(buf, { planeIndex: 0, format: 'f32-planar' });
      rate = sample.sampleRate;
      parts.push(buf);
      total += buf.length;
      sample.close();
    }
    const mono = new Float32Array(total);
    let o = 0;
    for (const p of parts) {
      mono.set(p, o);
      o += p.length;
    }
    const profile = measureNoiseProfile(mono, rate);
    return { result: { profile }, transfer: [profile.buffer] };
  } finally {
    input.dispose();
  }
}

/** Integrated loudness (LUFS) of a source range, for Normalize. */
async function loudness({ opfsPath, from, to }: { opfsPath: string; from: number; to: number }) {
  const file = await openFile(opfsPath);
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) throw new Error('no audio track');
    let meter: LoudnessMeter | null = null;
    let scratch: Float32Array[] = [];
    for await (const sample of new AudioSampleSink(track).samples(from, to)) {
      const n = sample.numberOfFrames;
      if (scratch.length !== sample.numberOfChannels || scratch[0].length !== n)
        scratch = Array.from({ length: sample.numberOfChannels }, () => new Float32Array(n));
      for (let c = 0; c < sample.numberOfChannels; c++) sample.copyTo(scratch[c], { planeIndex: c, format: 'f32-planar' });
      // Mono counts as one channel, stereo as two (BS.1770 channel weights 1).
      meter ??= new LoudnessMeter(sample.sampleRate);
      meter.push(scratch, n);
      sample.close();
    }
    return { result: { lufs: meter ? meter.result() : -Infinity } };
  } finally {
    input.dispose();
  }
}

const handlers = { thumbnails, waveform, mixdown16k, noiseProfile, loudness };
export type MediaWorkerApi = typeof handlers;
exposeRpc(handlers);
