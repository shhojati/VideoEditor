// Beats and markers on the timeline. Music assets carry a detected beat grid (Asset.beats, source
// seconds); markers are the project's own timeline points. Like timeline.ts, the edits mutate the
// project and are meant to run inside edit().
import { newId } from './factories';
import { findClip, MIN_CLIP_DURATION } from './timeline';
import type { Clip, ID, Project } from './types';
import { handles, sourceLength, timelineTimeAt } from './remap';

const EPS = 1e-6;

/** A clip's beats on the timeline (only the part of the source it plays). */
export function clipBeats(p: Project, clip: Clip): number[] {
  const grid = clip.assetId ? p.assets[clip.assetId]?.beats : undefined;
  if (!grid) return [];
  if (clip.freeze) return [];
  const srcEnd = clip.inPoint + sourceLength(clip);
  const times = grid.times.filter((s) => s >= clip.inPoint - EPS && s <= srcEnd + EPS).map((s) => timelineTimeAt(clip, s));
  return clip.reversed ? times.reverse() : times;
}

/** Every beat on the timeline from clips on unmuted tracks, ascending (optionally skipping some clips). */
export function timelineBeats(p: Project, skip: ReadonlySet<ID> = new Set()): number[] {
  const all: number[] = [];
  for (const track of p.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) if (!skip.has(clip.id)) all.push(...clipBeats(p, clip));
  }
  all.sort((a, b) => a - b);
  return all.filter((t, i) => i === 0 || t - all[i - 1] > 1e-3);
}

/** Add a marker at `t`, or remove the one already within `tolerance` of it. Returns true if added. */
export function toggleMarker(p: Project, t: number, tolerance: number): boolean {
  const markers = (p.markers ??= []);
  const near = markers.findIndex((m) => Math.abs(m.t - t) <= tolerance);
  if (near >= 0) {
    markers.splice(near, 1);
    return false;
  }
  markers.push({ id: newId(), t: Math.max(0, t) });
  markers.sort((a, b) => a.t - b.t);
  return true;
}

export type CutToBeatResult = { ok: true; count: number } | { ok: false; reason: 'noClips' | 'noBeats' | 'blocked' };

/**
 * Lay the selected clips (of the first selected clip's track) end to end from the beat nearest the
 * first one, each lasting `every` beats: photos are stretched, videos trimmed (a video too short
 * for `every` beats takes fewer, or ends off-beat if it is shorter than one). Uses the beats of
 * the other clips on the timeline.
 */
export function cutToBeat(p: Project, ids: readonly ID[], every: number): CutToBeatResult {
  const first = ids.map((id) => findClip(p, id)).find((r) => r && !r.track.locked && r.clip.assetId && r.track.kind === 'video');
  if (!first) return { ok: false, reason: 'noClips' };
  const track = first.track;
  const picked = new Set(ids);
  const clips = track.clips.filter((c) => picked.has(c.id) && c.assetId);
  const beats = timelineBeats(p, picked);
  if (beats.length < 2) return { ok: false, reason: 'noBeats' };
  const lastGap = beats[beats.length - 1] - beats[beats.length - 2];
  const beatAt = (k: number) => (k < beats.length ? beats[k] : beats[beats.length - 1] + (k - beats.length + 1) * lastGap);

  let k = beats.reduce((best, b, i) => (Math.abs(b - clips[0].start) < Math.abs(beats[best] - clips[0].start) ? i : best), 0);
  let t = beats[k];
  const plan: { clip: Clip; start: number; duration: number }[] = [];
  for (const clip of clips) {
    const asset = p.assets[clip.assetId!];
    const maxDur = asset?.kind === 'image' || asset?.duration === undefined ? Infinity : clip.duration + handles(clip, asset.duration).after;
    let m = every;
    while (m > 1 && beatAt(k + m) - t > maxDur + EPS) m--;
    const duration = Math.max(MIN_CLIP_DURATION, Math.min(beatAt(k + m) - t, maxDur));
    plan.push({ clip, start: t, duration });
    t += duration;
    // Continue from the beat where this clip ended (or the next one, if it ended off-beat).
    while (beatAt(k) < t - 1e-3) k++;
  }
  const from = plan[0].start;
  const to = t;
  if (track.clips.some((c) => !picked.has(c.id) && c.start < to - EPS && c.start + c.duration > from + EPS)) return { ok: false, reason: 'blocked' };
  for (const { clip, start, duration } of plan) {
    clip.start = start;
    clip.duration = duration;
  }
  track.clips.sort((a, b) => a.start - b.start);
  return { ok: true, count: plan.length };
}
