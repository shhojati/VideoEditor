// Speed edits: ramp presets and custom curves, reverse, freeze frames. Like timeline.ts these mutate
// the project inside edit(); the timing maths is in remap.ts.
import { newId } from './factories';
import { keyedClip } from './keyframes';
import { lerpNumber, lerpPath, valueAt } from './masks';
import { isOverlay } from './overlays';
import { keyTimeAt, mediaTimeAt, meanSpeed, sourceLength, SPEED_RANGE } from './remap';
import { cloneClip, findClip, insertClip, MIN_CLIP_DURATION, splitClips } from './timeline';
import type { Clip, ID, Project, SpeedPoint, SpeedPreset } from './types';

/** CapCut-style ramps (absolute speeds over the clip). */
export const SPEED_PRESETS: Record<Exclude<SpeedPreset, 'custom'>, SpeedPoint[]> = {
  // Slow, fast, slow, fast.
  montage: [
    [0, 1],
    [0.2, 0.5],
    [0.4, 3],
    [0.6, 0.5],
    [0.8, 3],
    [1, 1],
  ],
  // Fast, a long slow-motion moment in the middle, fast again.
  hero: [
    [0, 2],
    [0.3, 2],
    [0.42, 0.3],
    [0.62, 0.3],
    [0.74, 2],
    [1, 2],
  ],
  // Very fast with a short, very slow middle ("bullet time").
  bullet: [
    [0, 3],
    [0.35, 3],
    [0.45, 0.15],
    [0.6, 0.15],
    [0.7, 3],
    [1, 3],
  ],
  flashIn: [
    [0, 5],
    [0.35, 5],
    [0.6, 1],
    [1, 1],
  ],
  flashOut: [
    [0, 1],
    [0.4, 1],
    [0.65, 5],
    [1, 5],
  ],
  // Normal, two quick jumps forward.
  jumpCut: [
    [0, 1],
    [0.28, 1],
    [0.3, 6],
    [0.4, 6],
    [0.42, 1],
    [0.68, 1],
    [0.7, 6],
    [0.8, 6],
    [0.82, 1],
    [1, 1],
  ],
};

export const MAX_CURVE_POINTS = 32;
const clampSpeed = (v: number) => Math.min(SPEED_RANGE.max, Math.max(SPEED_RANGE.min, v));

/** A valid curve: sorted, from u = 0 to u = 1, speeds in range, at most 32 points. */
export function normalizeCurve(points: readonly SpeedPoint[]): SpeedPoint[] {
  const inner = points
    .filter(([u]) => u > 0 && u < 1)
    .map(([u, v]): SpeedPoint => [u, clampSpeed(v)])
    .sort((a, b) => a[0] - b[0])
    .slice(0, MAX_CURVE_POINTS - 2);
  const first = points.find(([u]) => u <= 0)?.[1] ?? inner[0]?.[1] ?? 1;
  const last = [...points].reverse().find(([u]) => u >= 1)?.[1] ?? inner.at(-1)?.[1] ?? 1;
  return [[0, clampSpeed(first)], ...inner, [1, clampSpeed(last)]];
}

/** Clips whose speed can change: media clips (not overlays, not freeze frames). */
export const canRetime = (clip: Clip) => !!clip.assetId && !isOverlay(clip) && !clip.freeze;

/**
 * Give a clip a speed ramp, keeping the source range it plays: its length on the timeline becomes
 * that range over the curve's average speed (shortened if it would run into the next clip).
 * `null` goes back to a constant speed (the curve's average).
 */
export function setSpeedCurve(p: Project, clipId: ID, curve: readonly SpeedPoint[] | null, preset: SpeedPreset = 'custom'): boolean {
  const ref = findClip(p, clipId);
  if (!ref || ref.track.locked || !canRetime(ref.clip)) return false;
  const { clip, track, clipIndex } = ref;
  const length = sourceLength(clip);
  const next = track.clips[clipIndex + 1];
  const fit = (d: number) => Math.max(MIN_CLIP_DURATION, next ? Math.min(d, next.start - clip.start) : d);
  if (!curve) {
    clip.speed = Math.round(meanSpeed(clip) * 100) / 100;
    delete clip.speedCurve;
    delete clip.speedPreset;
    clip.duration = fit(length / clip.speed);
    return true;
  }
  const points = normalizeCurve(curve);
  clip.speedCurve = points;
  clip.speedPreset = preset;
  clip.duration = fit(length / meanSpeed(clip));
  return true;
}

/** Largest source range Reverse makes a reversed copy of (s). */
export const MAX_REVERSE_SECONDS = 180;

/**
 * Point a clip at a reversed copy of its media, or back at the original. A reversed copy of the
 * source range [from, to] shows source time s at time to − s, so every source time the clip
 * stores flips the same way (`mirror` = to): in-point, keyframes (animations stay where they were
 * on the timeline), mask keys, trackers, and the motion links of other clips that follow its
 * trackers. The clip keeps its length and speed ramp.
 */
export function flipToMedia(p: Project, clip: Clip, assetId: ID, mirror: number) {
  const flip = (t: number) => mirror - t;
  const flipKeys = <T extends { t: number }>(keys: T[] | undefined) => {
    if (!keys) return;
    for (const k of keys) k.t = flip(k.t);
    keys.sort((a, b) => a.t - b.t);
  };
  clip.inPoint = Math.max(0, flip(clip.inPoint + sourceLength(clip)));
  clip.assetId = assetId;
  flipKeys(clip.keyframes);
  for (const m of clip.masks ?? []) {
    flipKeys(m.path.keys);
    flipKeys(m.feather.keys);
    flipKeys(m.expansion.keys);
    flipKeys(m.opacity.keys);
    if (m.track) m.track.ref = flip(m.track.ref);
  }
  for (const tr of clip.trackers ?? []) {
    tr.samples = tr.samples.map((s) => [flip(s[0]), s[1], s[2], s[3], s[4]] as typeof s).reverse();
    if (tr.lostAt !== undefined) tr.lostAt = flip(tr.lostAt);
  }
  for (const track of p.tracks) for (const c of track.clips) if (c.motion?.clipId === clip.id) c.motion.ref = flip(c.motion.ref);
}

export const FREEZE_DEFAULT = 2;

/**
 * Freeze the frame at time t for `seconds`: the clip is split there and a still of that frame is
 * inserted, pushing the rest of the track later. The still keeps the clip's look at that moment
 * (transform, effects, blend, masks), with its keyframes and mask animation baked in. Returns the
 * new clip's id.
 */
export function freezeFrame(p: Project, clipId: ID, t: number, seconds = FREEZE_DEFAULT): ID | null {
  const ref = findClip(p, clipId);
  if (!ref || ref.track.locked || !ref.clip.assetId || isOverlay(ref.clip) || ref.clip.freeze) return null;
  const { track } = ref;
  const asset = p.assets[ref.clip.assetId];
  if (asset?.kind !== 'video') return null;
  const end = ref.clip.start + ref.clip.duration;
  if (t < ref.clip.start - 1e-6 || t > end + 1e-6) return null;
  const at = Math.min(Math.max(t, ref.clip.start), end);
  const source = ref.clip;
  const media = mediaTimeAt(source, at);
  const key = keyTimeAt(source, at);
  // The look at that moment, keyframes evaluated.
  const look = keyedClip(source, at);
  const still: Clip = {
    ...cloneClip(look),
    id: newId(),
    start: at,
    duration: Math.max(MIN_CLIP_DURATION, seconds),
    inPoint: media,
    speed: 1,
    freeze: true,
    audio: { volume: 1, fadeIn: 0, fadeOut: 0 },
  };
  delete still.speedCurve;
  delete still.speedPreset;
  delete still.keyframes;
  delete still.trackers;
  delete still.motion;
  for (const m of still.masks ?? []) {
    m.path = { value: valueAt(m.path, key, lerpPath) };
    m.feather = { value: valueAt(m.feather, key, lerpNumber) };
    m.expansion = { value: valueAt(m.expansion, key, lerpNumber) };
    m.opacity = { value: valueAt(m.opacity, key, lerpNumber) };
    // A tracked mask would need the tracker, which the still does not carry.
    delete m.track;
  }
  // Make room: split at the frame (if inside) and push everything after it later.
  if (at > source.start + MIN_CLIP_DURATION && end - at > MIN_CLIP_DURATION) splitClips(p, at, new Set([source.id]));
  for (const c of track.clips) if (c.start >= at - 1e-6) c.start += still.duration;
  insertClip(track, still);
  return still.id;
}
