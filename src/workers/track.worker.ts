/// <reference lib="webworker" />
// Motion tracking: decodes a video clip's frames at a reduced size, follows the box with the
// BoxTracker and streams the samples back. Forward runs read the media in order; backward runs
// decode short chunks in order and process each chunk in reverse.
import { ALL_FORMATS, BlobSource, Input, VideoSampleSink, type VideoSample } from 'mediabunny';
import { BoxTracker, toGray, TrackingError, type BoxPose, type Gray } from '../engine/track/klt';
import { getMediaFile } from '../lib/opfs';
import type { TrackSample } from '../model/types';

export interface TrackRequest {
  type: 'start';
  opfsPath: string;
  /** Source times: start (where the box is) and the end of the run (before `from` when backward). */
  from: number;
  to: number;
  dir: 1 | -1;
  /** The box at `from`: centre and size as fractions of the frame, angle (°), scale. */
  box: { x: number; y: number; width: number; height: number; angle: number; scale: number };
}

export type TrackMessage =
  | { type: 'progress'; samples: TrackSample[]; done: number }
  | { type: 'done'; lostAt?: number }
  | { type: 'error'; reason: 'featureless' | 'media' | 'failed'; message?: string };

/** Longest side of the frames the tracker works on (px). */
const WORK_SIZE = 640;
/** Backward runs decode this much media at a time (s). */
const CHUNK = 0.5;
const POST_EVERY = 6;

const post = (m: TrackMessage) => self.postMessage(m);
let cancelled = false;

self.onmessage = ({ data }: MessageEvent<TrackRequest | { type: 'cancel' }>) => {
  if (data.type === 'cancel') {
    cancelled = true;
    return;
  }
  run(data).catch((e: unknown) => {
    if (e instanceof TrackingError) post({ type: 'error', reason: 'featureless' });
    else post({ type: 'error', reason: 'failed', message: e instanceof Error ? e.message : String(e) });
  });
};

async function run(req: TrackRequest) {
  const file = await getMediaFile(req.opfsPath);
  const track = file && (await new Input({ source: new BlobSource(file), formats: ALL_FORMATS }).getPrimaryVideoTrack());
  if (!track || !(await track.canDecode())) {
    post({ type: 'error', reason: 'media' });
    return;
  }
  const sink = new VideoSampleSink(track);
  const first = await sink.getSample(req.from);
  if (!first) {
    post({ type: 'error', reason: 'media' });
    return;
  }
  const scale = Math.min(1, WORK_SIZE / Math.max(first.displayWidth, first.displayHeight));
  const w = Math.max(16, Math.round(first.displayWidth * scale));
  const h = Math.max(16, Math.round(first.displayHeight * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const gray = (s: VideoSample): Gray => {
    s.draw(ctx, 0, 0, w, h);
    s.close();
    return toGray(ctx.getImageData(0, 0, w, h).data, w, h);
  };

  const { box } = req;
  const firstTime = first.timestamp;
  const tracker = new BoxTracker(gray(first), box.width * w, box.height * h, { cx: box.x * w, cy: box.y * h, angle: (box.angle * Math.PI) / 180, scale: box.scale });
  const toSample = (t: number, p: BoxPose): TrackSample => [t, p.cx / w, p.cy / h, (p.angle * 180) / Math.PI, p.scale];

  const span = Math.abs(req.to - req.from) || 1;
  let out: TrackSample[] = [[req.from, box.x, box.y, box.angle, box.scale]];
  /** Samples carried by motion alone; kept only once the object is recognised again. */
  let unsure: TrackSample[] = [];
  let since = 0;
  const flush = (t: number) => {
    if (!out.length) return;
    post({ type: 'progress', samples: req.dir === 1 ? out : out.reverse(), done: Math.min(1, Math.abs(t - req.from) / span) });
    out = [];
  };
  /** Feed one frame; false when the run ends (lost or cancelled). */
  const step = (t: number, frame: Gray): boolean => {
    if (cancelled) return false;
    const pose = tracker.step(frame);
    if (!pose) {
      flush(t);
      post({ type: 'done', lostAt: unsure[0]?.[0] ?? t });
      return false;
    }
    const sample = toSample(t, pose);
    if (!tracker.confident) unsure.push(sample);
    else {
      out.push(...unsure, sample);
      unsure = [];
    }
    if (++since >= POST_EVERY) {
      since = 0;
      flush(t);
    }
    return true;
  };

  if (req.dir === 1) {
    for await (const s of sink.samples(firstTime + 1e-6, req.to)) {
      if (s.timestamp <= firstTime + 1e-6) {
        s.close();
        continue;
      }
      const t = s.timestamp;
      if (!step(t, gray(s))) return;
    }
  } else {
    let before = firstTime;
    while (before > req.to + 1e-6) {
      const chunkStart = Math.max(req.to, before - CHUNK);
      const frames: { t: number; g: Gray }[] = [];
      for await (const s of sink.samples(chunkStart, before)) {
        if (cancelled || s.timestamp >= before - 1e-6 || s.timestamp + s.duration <= req.to) {
          s.close();
          continue;
        }
        frames.push({ t: s.timestamp, g: gray(s) });
      }
      if (!frames.length) break;
      for (let i = frames.length - 1; i >= 0; i--) if (!step(Math.max(req.to, frames[i].t), frames[i].g)) return;
      before = frames[0].t;
    }
  }
  out.push(...unsure);
  flush(req.to);
  post({ type: 'done' });
}
