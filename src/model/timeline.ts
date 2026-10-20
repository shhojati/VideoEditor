// Pure timeline operations on the project document. They mutate the given project, so call them
// inside useProjectStore().edit() (Immer draft) — or on a plain object in tests.
// Invariant: clips on one track never overlap and are kept sorted by start.
import { newId } from './factories';
import type { Asset, AssetKind, Clip, ID, Project, Track, TrackKind } from './types';

/** Shortest clip a trim or split may leave behind (s). */
export const MIN_CLIP_DURATION = 0.1;
/** Default length of a still image dropped on the timeline (s). */
export const IMAGE_DEFAULT_DURATION = 5;
const EPS = 1e-6;

/** Deep copy that also works on Immer drafts (structuredClone rejects Proxies). */
const cloneClip = (c: Clip): Clip => JSON.parse(JSON.stringify(c));

export const clipEnd = (c: Pick<Clip, 'start' | 'duration'>) => c.start + c.duration;

export function trackAccepts(track: Pick<Track, 'kind'>, assetKind: AssetKind): boolean {
  if (track.kind === 'video') return assetKind === 'video' || assetKind === 'image';
  if (track.kind === 'audio') return assetKind === 'audio';
  return false;
}

export const trackKindFor = (assetKind: AssetKind): TrackKind => (assetKind === 'audio' ? 'audio' : 'video');

export function createClip(asset: Asset, start: number): Clip {
  return {
    id: newId(),
    assetId: asset.id,
    start,
    duration: asset.kind === 'image' ? IMAGE_DEFAULT_DURATION : (asset.duration ?? IMAGE_DEFAULT_DURATION),
    inPoint: 0,
    speed: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    audio: { volume: 1, fadeIn: 0, fadeOut: 0 },
  };
}

export interface ClipRef {
  track: Track;
  trackIndex: number;
  clip: Clip;
  clipIndex: number;
}

export function findClip(p: Project, clipId: ID): ClipRef | undefined {
  for (const [trackIndex, track] of p.tracks.entries()) {
    const clipIndex = track.clips.findIndex((c) => c.id === clipId);
    if (clipIndex >= 0) return { track, trackIndex, clip: track.clips[clipIndex], clipIndex };
  }
  return undefined;
}

export function timelineDuration(p: Project): number {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  for (const st of p.subtitleTracks) for (const c of st.cues) end = Math.max(end, c.end);
  return end;
}

/** Media clips cannot run past the end of their source; images and text can be any length. */
export function sourceLimited(asset: Asset | undefined) {
  return !!asset && asset.kind !== 'image' && asset.duration !== undefined;
}

export function isFree(track: Track, start: number, duration: number, ignore: ReadonlySet<ID> = new Set()) {
  if (start < -EPS) return false;
  const end = start + duration;
  return track.clips.every((c) => ignore.has(c.id) || end <= c.start + EPS || start >= clipEnd(c) - EPS);
}

/** The free start position closest to `desired` where a clip of `duration` fits. */
export function nearestFreeStart(track: Track, desired: number, duration: number, ignore: ReadonlySet<ID> = new Set()) {
  desired = Math.max(0, desired);
  if (isFree(track, desired, duration, ignore)) return desired;
  const others = track.clips.filter((c) => !ignore.has(c.id));
  // Candidates: right after each clip, and right before each clip.
  const candidates = [
    ...others.map(clipEnd),
    ...others.map((c) => c.start - duration).filter((s) => s >= 0),
  ].filter((s) => isFree(track, s, duration, ignore));
  candidates.sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired));
  return candidates[0] ?? Math.max(desired, ...others.map(clipEnd));
}

function sortClips(track: Track) {
  track.clips.sort((a, b) => a.start - b.start);
}

export function insertClip(track: Track, clip: Clip) {
  track.clips.push(clip);
  sortClips(track);
}

/** Split the given clips (or every clip under `time` on unlocked tracks) at `time`. Returns the new right-hand ids. */
export function splitClips(p: Project, time: number, clipIds?: ReadonlySet<ID>): ID[] {
  const created: ID[] = [];
  for (const track of p.tracks) {
    if (track.locked) continue;
    for (const clip of [...track.clips]) {
      if (clipIds && !clipIds.has(clip.id)) continue;
      const offset = time - clip.start;
      if (offset < MIN_CLIP_DURATION - EPS || clip.duration - offset < MIN_CLIP_DURATION - EPS) continue;
      const right: Clip = { ...cloneClip(clip), id: newId() };
      right.start = time;
      right.duration = clip.duration - offset;
      right.inPoint = clip.inPoint + offset * clip.speed;
      right.audio.fadeIn = 0;
      clip.duration = offset;
      clip.audio.fadeOut = 0;
      insertClip(track, right);
      created.push(right.id);
    }
  }
  return created;
}

export interface Range {
  min: number;
  max: number;
}

/**
 * Where an edge can go: limited by the neighbouring clips, the source media length, the minimum
 * clip length, and time 0.
 */
export function trimLimits(p: Project, clipId: ID, edge: 'start' | 'end'): Range {
  const ref = findClip(p, clipId);
  if (!ref) return { min: 0, max: 0 };
  const { track, clip, clipIndex } = ref;
  const asset = clip.assetId ? p.assets[clip.assetId] : undefined;
  const limited = sourceLimited(asset);
  const end = clipEnd(clip);
  if (edge === 'start') {
    const prevEnd = clipIndex > 0 ? clipEnd(track.clips[clipIndex - 1]) : 0;
    const sourceMin = limited ? clip.start - clip.inPoint / clip.speed : -Infinity;
    return { min: Math.max(prevEnd, sourceMin, 0), max: end - MIN_CLIP_DURATION };
  }
  const nextStart = clipIndex < track.clips.length - 1 ? track.clips[clipIndex + 1].start : Infinity;
  const sourceMax = limited ? clip.start + (asset!.duration! - clip.inPoint) / clip.speed : Infinity;
  return { min: clip.start + MIN_CLIP_DURATION, max: Math.min(nextStart, sourceMax) };
}

export const clamp = (v: number, r: Range) => Math.min(r.max, Math.max(r.min, v));

/** Move one edge of a clip to `time` (clamped to trimLimits). Returns the applied time. */
export function trimClip(p: Project, clipId: ID, edge: 'start' | 'end', time: number): number {
  const ref = findClip(p, clipId);
  if (!ref || ref.track.locked) return NaN;
  const t = clamp(time, trimLimits(p, clipId, edge));
  const { clip } = ref;
  if (edge === 'start') {
    const delta = t - clip.start;
    clip.inPoint = Math.max(0, clip.inPoint + delta * clip.speed);
    clip.duration -= delta;
    clip.start = t;
  } else {
    clip.duration = t - clip.start;
  }
  return t;
}

export interface ClipMove {
  clipId: ID;
  trackId: ID;
  start: number;
}

/** Can all moves be applied at once without overlaps, onto unlocked tracks that accept the clips? */
export function canMove(p: Project, moves: ClipMove[]): boolean {
  const moving = new Set(moves.map((m) => m.clipId));
  for (const [i, m] of moves.entries()) {
    const ref = findClip(p, m.clipId);
    const target = p.tracks.find((t) => t.id === m.trackId);
    if (!ref || !target || target.locked || ref.track.locked || m.start < -EPS) return false;
    if (target.kind !== ref.track.kind) return false;
    if (!isFree(target, m.start, ref.clip.duration, moving)) return false;
    // moved clips must not overlap each other either
    for (const other of moves.slice(i + 1)) {
      if (other.trackId !== m.trackId) continue;
      const o = findClip(p, other.clipId)!.clip;
      if (m.start < other.start + o.duration - EPS && other.start < m.start + ref.clip.duration - EPS) return false;
    }
  }
  return true;
}

export function moveClips(p: Project, moves: ClipMove[]): boolean {
  if (!canMove(p, moves)) return false;
  const lifted = moves.map((m) => {
    const ref = findClip(p, m.clipId)!;
    ref.track.clips.splice(ref.clipIndex, 1);
    return { clip: ref.clip, m };
  });
  for (const { clip, m } of lifted) {
    clip.start = Math.max(0, m.start);
    insertClip(p.tracks.find((t) => t.id === m.trackId)!, clip);
  }
  return true;
}

/**
 * Delete clips on unlocked tracks. With `ripple`, later clips on the same track shift left to close
 * each gap (safe: the clip before a gap always ends before it).
 */
export function deleteClips(p: Project, ids: ReadonlySet<ID>, ripple = false) {
  for (const track of p.tracks) {
    if (track.locked) continue;
    const removed = track.clips.filter((c) => ids.has(c.id));
    if (!removed.length) continue;
    track.clips = track.clips.filter((c) => !ids.has(c.id));
    if (!ripple) continue;
    for (const r of [...removed].sort((a, b) => b.start - a.start)) {
      for (const c of track.clips) if (c.start >= clipEnd(r) - EPS) c.start -= r.duration;
    }
    sortClips(track);
  }
}

/** Remove every clip that uses an asset (when the asset leaves the project). */
export function deleteClipsOfAsset(p: Project, assetId: ID) {
  for (const track of p.tracks) track.clips = track.clips.filter((c) => c.assetId !== assetId);
}

export interface ClipboardItem {
  clip: Clip;
  trackIndex: number;
  /** Offset from the earliest copied clip (s). */
  offset: number;
}

export function copyClips(p: Project, ids: ReadonlySet<ID>): ClipboardItem[] {
  const refs = [...ids].map((id) => findClip(p, id)).filter((r): r is ClipRef => !!r);
  if (!refs.length) return [];
  const t0 = Math.min(...refs.map((r) => r.clip.start));
  return refs.map((r) => ({ clip: cloneClip(r.clip), trackIndex: r.trackIndex, offset: r.clip.start - t0 }));
}

/**
 * Paste at `time`, keeping relative timing. Each clip goes to its original track (or the nearest
 * compatible unlocked one); if that spot is taken it lands at the nearest free position. Returns new ids.
 */
export function pasteClips(p: Project, items: ClipboardItem[], time: number): ID[] {
  const ids: ID[] = [];
  for (const item of items) {
    const kind = p.tracks[item.trackIndex]?.kind ?? (item.clip.text ? 'text' : undefined);
    let track = p.tracks[item.trackIndex];
    if (!track || track.locked || (kind && track.kind !== kind)) {
      track = p.tracks.find((t) => !t.locked && t.kind === kind) as Track;
    }
    if (!track) continue;
    const clip: Clip = { ...cloneClip(item.clip), id: newId() };
    clip.start = nearestFreeStart(track, time + item.offset, clip.duration);
    insertClip(track, clip);
    ids.push(clip.id);
  }
  return ids;
}

/** All clip edges plus 0 and the timeline end, sorted and unique — used for jump-to-edit and snapping. */
export function editPoints(p: Project, exclude: ReadonlySet<ID> = new Set()): number[] {
  const pts = new Set<number>([0]);
  for (const t of p.tracks)
    for (const c of t.clips) {
      if (exclude.has(c.id)) continue;
      pts.add(c.start);
      pts.add(clipEnd(c));
    }
  return [...pts].sort((a, b) => a - b);
}

export function cueBoundaries(p: Project): number[] {
  return p.subtitleTracks.flatMap((st) => st.cues.flatMap((c) => [c.start, c.end]));
}
