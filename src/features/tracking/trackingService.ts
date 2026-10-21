// Motion tracking actions: add a tracker box to a video clip, track it forwards/backwards in a
// worker, and use it — attach another clip, stabilize the clip, or cover the object with a blur /
// pixelate patch.
import { create } from 'zustand';
import { mergeSamples, motionTransform, sampleAt, trackerBox } from '../../engine/render/motion';
import { createEffect } from '../../model/effects';
import { newId } from '../../model/factories';
import { addAdjustmentClipAbove, findClip } from '../../model/timeline';
import type { Clip, ID, MotionLink, Project, Tracker, TrackSample } from '../../model/types';
import type { TrackMessage, TrackRequest } from '../../workers/track.worker';
import { useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { select } from '../timeline/timelineUi';

export interface TrackJob {
  clipId: ID;
  trackerId: ID;
  dir: 1 | -1;
  /** Source time the run started from. */
  from: number;
  progress: number;
  /** Samples tracked so far, in time order (shown live, written to the project at the end). */
  fresh: TrackSample[];
}

interface TrackingState {
  /** The tracker whose box is shown and edited on the canvas. */
  active: { clipId: ID; trackerId: ID } | null;
  job: TrackJob | null;
  error?: 'featureless' | 'media' | 'failed';
}

export const useTracking = create<TrackingState>()(() => ({ active: null, job: null }));

const project = () => useProjectStore.getState().history?.present;
const srcTime = (c: Clip, t: number) => c.inPoint + (t - c.start) * c.speed;
const timelineTime = (c: Clip, s: number) => c.start + (s - c.inPoint) / c.speed;
/** Source range the clip shows. */
const sourceRange = (c: Clip) => ({ start: c.inPoint, end: c.inPoint + c.duration * c.speed });

/** Playhead inside the clip (moving it there if needed); returns the timeline time. */
function playheadIn(clip: Clip): number {
  const { time, seek } = useTransport.getState();
  if (time >= clip.start && time < clip.start + clip.duration) return time;
  seek(clip.start);
  return clip.start;
}

export function setActiveTracker(clipId: ID, trackerId: ID | null) {
  useTracking.setState({ active: trackerId ? { clipId, trackerId } : null, error: undefined });
}

/** A new box in the middle of the visible picture, at the playhead. */
export function addTracker(clipId: ID, name: string) {
  const p = project();
  const ref = p && findClip(p, clipId);
  const asset = ref?.clip.assetId ? p!.assets[ref.clip.assetId] : undefined;
  if (!ref || !asset?.width || !asset.height) return;
  const t = playheadIn(ref.clip);
  const id = newId();
  useProjectStore.getState().edit('ops.addTracker', (d) => {
    const clip = findClip(d, clipId)?.clip;
    if (!clip) return;
    const crop = clip.transform.crop ?? { x: 0, y: 0, width: 1, height: 1 };
    const side = 0.2 * Math.min(asset.width! * crop.width, asset.height! * crop.height);
    const tracker: Tracker = {
      id,
      name,
      width: side / asset.width!,
      height: side / asset.height!,
      samples: [[srcTime(clip, t), crop.x + crop.width / 2, crop.y + crop.height / 2, 0, 1]],
    };
    (clip.trackers ??= []).push(tracker);
  });
  setActiveTracker(clipId, id);
}

export function deleteTracker(clipId: ID, trackerId: ID) {
  if (useTracking.getState().job?.trackerId === trackerId) cancelTracking();
  useProjectStore.getState().edit('ops.deleteTracker', (d) => {
    const clip = findClip(d, clipId)?.clip;
    if (!clip?.trackers) return;
    clip.trackers = clip.trackers.filter((x) => x.id !== trackerId);
    if (!clip.trackers.length) delete clip.trackers;
  });
  if (useTracking.getState().active?.trackerId === trackerId) setActiveTracker(clipId, null);
}

export function renameTracker(clipId: ID, trackerId: ID, name: string) {
  useProjectStore.getState().edit(
    'ops.renameTracker',
    (d) => {
      const tr = findClip(d, clipId)?.clip.trackers?.find((x) => x.id === trackerId);
      if (tr) tr.name = name;
    },
    { mergeKey: `tracker-name:${trackerId}` },
  );
}

// ---- tracking runs -------------------------------------------------------------------------------------

let worker: Worker | null = null;

/** Track from the playhead to the clip's end (1) or start (-1). */
export function startTracking(clipId: ID, trackerId: ID, dir: 1 | -1) {
  cancelTracking();
  const p = project();
  const ref = p && findClip(p, clipId);
  const tracker = ref?.clip.trackers?.find((x) => x.id === trackerId);
  const asset = ref?.clip.assetId ? p!.assets[ref.clip.assetId] : undefined;
  if (!ref || !tracker || !asset?.fileRef.opfsPath) return;
  const clip = ref.clip;
  const range = sourceRange(clip);
  const from = Math.min(range.end, Math.max(range.start, srcTime(clip, playheadIn(clip))));
  const at = sampleAt(tracker, from)!;
  const req: TrackRequest = {
    type: 'start',
    opfsPath: asset.fileRef.opfsPath,
    from,
    to: dir === 1 ? range.end : range.start,
    dir,
    box: { x: at[1], y: at[2], width: tracker.width, height: tracker.height, angle: at[3], scale: at[4] },
  };
  const w = new Worker(new URL('../../workers/track.worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  useTracking.setState({ active: { clipId, trackerId }, job: { clipId, trackerId, dir, from, progress: 0, fresh: [] }, error: undefined });
  w.onmessage = ({ data }: MessageEvent<TrackMessage>) => {
    if (worker !== w) return;
    const job = useTracking.getState().job;
    if (!job) return;
    if (data.type === 'progress') {
      const fresh = dir === 1 ? [...job.fresh, ...data.samples] : [...data.samples, ...job.fresh];
      useTracking.setState({ job: { ...job, fresh, progress: data.done } });
      // The preview follows the run, so the box can be watched on the picture.
      const last = dir === 1 ? fresh[fresh.length - 1] : fresh[0];
      const c = findClip(project()!, clipId)?.clip;
      if (c && last) useTransport.getState().seek(timelineTime(c, last[0]));
      return;
    }
    finish(data.type === 'done' ? { lostAt: data.lostAt } : { error: data.reason });
  };
  w.onerror = () => finish({ error: 'failed' });
  w.postMessage(req);
}

/** Write what was tracked into the project (one undo step) and stop the worker. */
function finish(result: { lostAt?: number; error?: TrackingState['error'] }) {
  const job = useTracking.getState().job;
  worker?.terminate();
  worker = null;
  useTracking.setState({ job: null, error: result.error });
  if (!job || job.fresh.length < 2) return;
  useProjectStore.getState().edit('ops.track', (d) => {
    const tr = findClip(d, job.clipId)?.clip.trackers?.find((x) => x.id === job.trackerId);
    if (!tr) return;
    tr.samples = mergeSamples(tr.samples, job.fresh, job.from, job.dir);
    if (result.lostAt !== undefined) tr.lostAt = result.lostAt;
    else delete tr.lostAt;
  });
}

/** Stop a run, keeping what was tracked so far. */
export function cancelTracking() {
  if (!worker) return;
  worker.postMessage({ type: 'cancel' });
  finish({});
}

// ---- using a tracker -----------------------------------------------------------------------------------

/** Link `targetId` to follow the tracker; the clip keeps its current place at the playhead. */
export function attachToTracker(targetId: ID, sourceClipId: ID, trackerId: ID, parts: Pick<MotionLink, 'position' | 'rotation' | 'scale'> = { position: true, rotation: false, scale: false }) {
  const p = project();
  const src = p && findClip(p, sourceClipId)?.clip;
  if (!src || targetId === sourceClipId) return;
  const ref = srcTime(src, useTransport.getState().time);
  useProjectStore.getState().edit('ops.attachTracker', (d) => {
    const target = findClip(d, targetId);
    if (target && !target.track.locked) target.clip.motion = { clipId: sourceClipId, trackerId, mode: 'follow', ...parts, ref };
  });
}

/** Move the tracked clip against the object so it stays still (the frame at the playhead is the reference). */
export function stabilize(clipId: ID, trackerId: ID) {
  const p = project();
  const clip = p && findClip(p, clipId)?.clip;
  if (!clip) return;
  const ref = srcTime(clip, playheadIn(clip));
  useProjectStore.getState().edit('ops.stabilize', (d) => {
    const c = findClip(d, clipId)?.clip;
    if (c) c.motion = { clipId, trackerId, mode: 'stabilize', position: true, rotation: true, scale: false, ref };
  });
}

export function setLink(clipId: ID, change: Partial<Pick<MotionLink, 'position' | 'rotation' | 'scale'>>) {
  useProjectStore.getState().edit('ops.motionLink', (d) => {
    const c = findClip(d, clipId)?.clip;
    if (c?.motion) Object.assign(c.motion, change);
  });
}

export function detach(clipId: ID) {
  const p = project();
  const clip = p && findClip(p, clipId)?.clip;
  if (!clip?.motion) return;
  // Keep the clip where it is drawn now, so detaching does not make it jump.
  const drawn = motionTransform(p!, clip, useTransport.getState().time);
  useProjectStore.getState().edit('ops.detachTracker', (d) => {
    const c = findClip(d, clipId)?.clip;
    if (!c) return;
    delete c.motion;
    c.transform = { ...drawn };
  });
}

/** An adjustment layer masked to the object (ellipse), blurring or pixelating what is below, following it. */
export function coverObject(clipId: ID, trackerId: ID, kind: 'blur' | 'pixelate') {
  const p = project();
  const ref = p && findClip(p, clipId);
  const tracker = ref?.clip.trackers?.find((x) => x.id === trackerId);
  if (!ref || !tracker) return;
  const clip = ref.clip;
  const t = playheadIn(clip);
  const box = trackerBox(p!, clip, tracker, t);
  if (!box) return;
  const { width: W, height: H } = p!.settings;
  const trackIndex = p!.tracks.indexOf(ref.track);
  let id = '';
  useProjectStore.getState().edit('ops.coverObject', (d) => {
    id = addAdjustmentClipAbove(d, trackIndex, clip.start, clip.duration, {
      effects: [kind === 'blur' ? createEffect('gaussianBlur', { blurriness: 40, repeatEdge: true }) : createEffect('mosaic', { blockSize: 24 })],
      // A little larger than the box, soft-edged.
      mask: { kind: 'ellipse', width: box.w * 1.15, height: box.h * 1.15, feather: Math.min(box.w, box.h) * 0.08 },
      transform: { x: (box.cx - W / 2) / W, y: (box.cy - H / 2) / H, scale: 1, rotation: (box.rotation * 180) / Math.PI, opacity: 1 },
    });
    const c = findClip(d, id)?.clip;
    if (c) c.motion = { clipId, trackerId, mode: 'follow', position: true, rotation: true, scale: true, ref: srcTime(clip, t) };
  });
  select([id]);
}

/** Every tracker in the project, for "follow" pickers. */
export function allTrackers(p: Project): { clip: Clip; tracker: Tracker }[] {
  const seen = new Set<ID>();
  const out: { clip: Clip; tracker: Tracker }[] = [];
  for (const track of p.tracks)
    for (const clip of track.clips)
      for (const tracker of clip.trackers ?? []) {
        if (seen.has(tracker.id)) continue; // split clips share their trackers
        seen.add(tracker.id);
        out.push({ clip, tracker });
      }
  return out;
}
