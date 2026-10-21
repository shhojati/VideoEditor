// Motion tracking at render time: where a tracked object is at a moment, and how a linked clip moves
// with it (follow) or how the tracked clip moves against it (stabilize). Pure; shared by preview,
// export and the canvas editor.
//
// A tracker's samples live in source time and source fractions. A pose maps the object's own
// frame to the canvas: centre, angle (radians, clockwise) and scale (canvas px per source px at
// the tracker's scale 1).
import type { Clip, MotionLink, Project, Tracker, TrackSample, Transform } from '../../model/types';
import { placeMedia } from './placement';

export interface Pt {
  x: number;
  y: number;
}

export interface Pose {
  x: number;
  y: number;
  angle: number;
  scale: number;
}

/** A rotated rectangle on the canvas (project pixels; rotation in radians, clockwise). */
export interface RotatedBox {
  cx: number;
  cy: number;
  w: number;
  h: number;
  rotation: number;
}

const RAD = Math.PI / 180;
const srcTime = (c: Clip, t: number) => c.inPoint + (t - c.start) * c.speed;
const timelineTime = (c: Clip, s: number) => c.start + (s - c.inPoint) / c.speed;
const rotate = (p: Pt, a: number, k = 1): Pt => ({ x: k * (p.x * Math.cos(a) - p.y * Math.sin(a)), y: k * (p.x * Math.sin(a) + p.y * Math.cos(a)) });

/** The sample at source time s: linear between samples, held before the first and after the last. */
export function sampleAt(tracker: Tracker, s: number): TrackSample | undefined {
  const a = tracker.samples;
  if (!a.length) return undefined;
  if (s <= a[0][0]) return a[0];
  const last = a[a.length - 1];
  if (s >= last[0]) return last;
  let lo = 0;
  let hi = a.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (a[mid][0] <= s) lo = mid;
    else hi = mid;
  }
  const p = a[lo];
  const q = a[hi];
  const f = (s - p[0]) / (q[0] - p[0] || 1);
  const mix = (i: number) => p[i] + (q[i] - p[i]) * f;
  return [s, mix(1), mix(2), mix(3), mix(4)];
}

/** Source pixels ↔ canvas pixels for a media clip placed by `tr`. */
export function mediaMap(sw: number, sh: number, W: number, H: number, tr: Transform) {
  const p = placeMedia(sw, sh, W, H, tr);
  const f = p.frame.w / sw;
  return {
    rotation: p.rotation,
    /** Canvas px per source px. */
    f,
    toCanvas(x: number, y: number): Pt {
      const r = rotate({ x: p.frame.x + x * f, y: p.frame.y + y * f }, p.rotation);
      return { x: p.cx + r.x, y: p.cy + r.y };
    },
    toSource(c: Pt): Pt {
      const l = rotate({ x: c.x - p.cx, y: c.y - p.cy }, -p.rotation);
      return { x: (l.x - p.frame.x) / f, y: (l.y - p.frame.y) / f };
    },
  };
}

function sourceSize(project: Project, clip: Clip) {
  const a = clip.assetId ? project.assets[clip.assetId] : undefined;
  return a?.width && a.height ? { sw: a.width, sh: a.height } : undefined;
}

/** Where the tracked object is on the canvas when its clip is placed by `tr`, at source time s. */
function canvasPose(project: Project, clip: Clip, tracker: Tracker, tr: Transform, s: number): Pose | undefined {
  const size = sourceSize(project, clip);
  const sample = sampleAt(tracker, s);
  if (!size || !sample) return undefined;
  const m = mediaMap(size.sw, size.sh, project.settings.width, project.settings.height, tr);
  const c = m.toCanvas(sample[1] * size.sw, sample[2] * size.sh);
  return { x: c.x, y: c.y, angle: m.rotation + sample[3] * RAD, scale: m.f * sample[4] };
}

/** Every clip carrying the tracker (a split clip keeps it on both parts). */
export function clipsWithTracker(project: Project, trackerId: string): { clip: Clip; tracker: Tracker }[] {
  const out: { clip: Clip; tracker: Tracker }[] = [];
  for (const track of project.tracks)
    for (const clip of track.clips) {
      const tracker = clip.trackers?.find((x) => x.id === trackerId);
      if (tracker) out.push({ clip, tracker });
    }
  return out;
}

/**
 * The tracker a link uses at time t: stabilize always uses the clip's own; follow prefers a
 * carrying clip on screen at t (after a split), then the linked clip.
 */
export function resolveTracker(project: Project, clip: Clip, link: MotionLink, t: number): { clip: Clip; tracker: Tracker } | undefined {
  if (link.mode === 'stabilize') {
    const tracker = clip.trackers?.find((x) => x.id === link.trackerId);
    return tracker && { clip, tracker };
  }
  let fallback: { clip: Clip; tracker: Tracker } | undefined;
  for (const hit of clipsWithTracker(project, link.trackerId)) {
    if (hit.clip.id === clip.id) continue;
    if (t >= hit.clip.start && t < hit.clip.start + hit.clip.duration) return hit;
    if (!fallback || (hit.clip.id === link.clipId && fallback.clip.id !== link.clipId)) fallback = hit;
  }
  return fallback;
}

const MAX_DEPTH = 3;

interface Delta {
  /** Rotation (radians) and scale factor to apply. */
  da: number;
  k: number;
  /** Follow: maps the base centre to the moved centre. Stabilize: the offset added to the base centre. */
  move: (c: Pt) => Pt;
  unmove: (c: Pt) => Pt;
}

/** How a linked clip's base transform changes at time t; undefined when it does not. */
function motionDelta(project: Project, clip: Clip, t: number, depth: number): Delta | undefined {
  const link = clip.motion;
  if (!link || depth > MAX_DEPTH) return undefined;
  const src = resolveTracker(project, clip, link, t);
  if (!src) return undefined;
  const { width: W, height: H } = project.settings;
  if (link.mode === 'stabilize') {
    const size = sourceSize(project, clip);
    const now = sampleAt(src.tracker, srcTime(clip, t));
    const then = sampleAt(src.tracker, link.ref);
    if (!size || !now || !then) return undefined;
    // In source pixels, G(X) = anchor + R(da)·k·(X − P) brings the object back to where it was at
    // the reference time; the clip is re-placed so its picture shows G applied.
    const da = link.rotation ? (then[3] - now[3]) * RAD : 0;
    const k = link.scale ? then[4] / now[4] : 1;
    const P = { x: now[1] * size.sw, y: now[2] * size.sh };
    const anchor = link.position ? { x: then[1] * size.sw, y: then[2] * size.sh } : P;
    const crop = clip.transform.crop ?? { x: 0, y: 0, width: 1, height: 1 };
    const Q = { x: (crop.x + crop.width / 2) * size.sw, y: (crop.y + crop.height / 2) * size.sh };
    const g = rotate({ x: Q.x - P.x, y: Q.y - P.y }, da, k);
    // The visible centre lands at the base placement of G(Q); that only depends on the base centre
    // additively, so the offset is measured once with the base placed at the frame centre.
    const centred = { ...clip.transform, x: 0, y: 0 };
    const c = mediaMap(size.sw, size.sh, W, H, centred).toCanvas(anchor.x + g.x, anchor.y + g.y);
    const off = { x: c.x - W / 2, y: c.y - H / 2 };
    return { da, k, move: (p) => ({ x: p.x + off.x, y: p.y + off.y }), unmove: (p) => ({ x: p.x - off.x, y: p.y - off.y }) };
  }
  const now = canvasPose(project, src.clip, src.tracker, motionTransform(project, src.clip, t, depth + 1), srcTime(src.clip, t));
  const tRef = timelineTime(src.clip, link.ref);
  const then = canvasPose(project, src.clip, src.tracker, motionTransform(project, src.clip, tRef, depth + 1), link.ref);
  if (!now || !then) return undefined;
  const da = link.rotation ? now.angle - then.angle : 0;
  const k = link.scale ? now.scale / then.scale : 1;
  if (!link.position) return { da, k, move: (p) => p, unmove: (p) => p };
  return {
    da,
    k,
    // The base centre keeps its offset from the object, turned and scaled with it.
    move: (p) => {
      const r = rotate({ x: p.x - then.x, y: p.y - then.y }, da, k);
      return { x: now.x + r.x, y: now.y + r.y };
    },
    unmove: (p) => {
      const r = rotate({ x: p.x - now.x, y: p.y - now.y }, -da, 1 / k);
      return { x: then.x + r.x, y: then.y + r.y };
    },
  };
}

/** The transform a clip is drawn with at timeline time t: its own, moved by its motion link. */
export function motionTransform(project: Project, clip: Clip, t: number, depth = 0): Transform {
  const d = motionDelta(project, clip, t, depth);
  if (!d) return clip.transform;
  const { width: W, height: H } = project.settings;
  const tr = clip.transform;
  const c = d.move({ x: W / 2 + tr.x * W, y: H / 2 + tr.y * H });
  return { ...tr, x: (c.x - W / 2) / W, y: (c.y - H / 2) / H, rotation: tr.rotation + d.da / RAD, scale: tr.scale * d.k };
}

/** The clip as drawn at time t (same object when it has no motion link). */
export function withMotion(project: Project, clip: Clip, t: number): Clip {
  if (!clip.motion) return clip;
  const transform = motionTransform(project, clip, t);
  return transform === clip.transform ? clip : { ...clip, transform };
}

/** The base transform that makes the clip appear with `drawn` at time t (canvas edits of linked clips). */
export function baseFromDrawn(project: Project, clip: Clip, t: number, drawn: Transform): Transform {
  const d = motionDelta(project, clip, t, 0);
  if (!d) return drawn;
  const { width: W, height: H } = project.settings;
  const rotation = drawn.rotation - d.da / RAD;
  const scale = drawn.scale / d.k;
  if (clip.motion?.mode === 'stabilize') {
    // The offset depends on the base rotation and scale but adds to the base position: measure it
    // with the new rotation/scale at position 0.
    const probe = { ...drawn, x: 0, y: 0, rotation, scale };
    const at = motionTransform(project, { ...clip, transform: probe }, t);
    return { ...probe, x: drawn.x - at.x, y: drawn.y - at.y };
  }
  const c = d.unmove({ x: W / 2 + drawn.x * W, y: H / 2 + drawn.y * H });
  return { ...drawn, x: (c.x - W / 2) / W, y: (c.y - H / 2) / H, rotation, scale };
}

// ---- tracker boxes ---------------------------------------------------------------------------------

/** The tracker's box on the canvas at timeline time t (the clip as drawn, stabilization included). */
export function trackerBox(project: Project, clip: Clip, tracker: Tracker, t: number): RotatedBox | undefined {
  const size = sourceSize(project, clip);
  const pose = size && canvasPose(project, clip, tracker, motionTransform(project, clip, t), srcTime(clip, t));
  if (!size || !pose) return undefined;
  return { cx: pose.x, cy: pose.y, w: tracker.width * size.sw * pose.scale, h: tracker.height * size.sh * pose.scale, rotation: pose.angle };
}

/**
 * A box moved / resized on the canvas at time t, as a sample at source time s (angle and scale
 * kept) plus the tracker size it implies.
 */
export function boxToSample(project: Project, clip: Clip, tracker: Tracker, t: number, s: number, box: RotatedBox): { sample: TrackSample; width: number; height: number } | undefined {
  const size = sourceSize(project, clip);
  const cur = sampleAt(tracker, s);
  if (!size || !cur) return undefined;
  const m = mediaMap(size.sw, size.sh, project.settings.width, project.settings.height, motionTransform(project, clip, t));
  const p = m.toSource({ x: box.cx, y: box.cy });
  const unit = m.f * cur[4];
  return {
    sample: [s, p.x / size.sw, p.y / size.sh, cur[3], cur[4]],
    width: box.w / (unit * size.sw),
    height: box.h / (unit * size.sh),
  };
}

const SAME_TIME = 1e-4;

/** Insert or replace the sample at its time, keeping the list sorted. */
export function putSample(samples: TrackSample[], sample: TrackSample) {
  const i = samples.findIndex((x) => x[0] >= sample[0] - SAME_TIME);
  if (i < 0) samples.push(sample);
  else if (Math.abs(samples[i][0] - sample[0]) <= SAME_TIME) samples[i] = sample;
  else samples.splice(i, 0, sample);
}

/**
 * Splice freshly tracked samples in: tracking forward from `from` replaces everything after it,
 * backward everything before it. `fresh` is in time order.
 */
export function mergeSamples(old: readonly TrackSample[], fresh: readonly TrackSample[], from: number, dir: 1 | -1): TrackSample[] {
  if (dir === 1) return [...old.filter((x) => x[0] < from - SAME_TIME), ...fresh];
  return [...fresh, ...old.filter((x) => x[0] > from + SAME_TIME)];
}

/** Drop links whose tracker is gone (run after every edit; a no-op otherwise). */
export function normalizeMotion(project: Project) {
  const ids = new Set<string>();
  for (const track of project.tracks) for (const clip of track.clips) for (const tr of clip.trackers ?? []) ids.add(tr.id);
  for (const track of project.tracks)
    for (const clip of track.clips) {
      const link = clip.motion;
      if (!link) continue;
      const own = !!clip.trackers?.some((x) => x.id === link.trackerId);
      if (link.mode === 'stabilize' ? !own : !ids.has(link.trackerId) || (own && clipsWithTracker(project, link.trackerId).length === 1)) delete clip.motion;
    }
}
