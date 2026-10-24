// Compound clips: several clips become one clip whose content is a nested timeline (a sequence in
// Project.sequences). Each compound clip owns its sequence (copies and splits copy it), so every
// inner clip exists exactly once and keeps a unique id. Like timeline.ts, edits mutate the project
// inside edit().
import { newId } from './factories';
import { retime } from './remap';
import { cloneClip } from './timeline';
import type { Clip, ID, Project, Sequence, Track } from './types';

/** Compound clips inside compound clips: at most this deep. */
export const MAX_NEST = 4;
const EPS = 1e-6;

const end = (c: Clip) => c.start + c.duration;

/** The project as seen from inside a sequence: its tracks are the sequence's (no subtitles or markers). */
export function sequenceView(p: Project, seqId: ID): Project {
  const seq = p.sequences?.[seqId];
  return { ...p, tracks: seq?.tracks ?? [], subtitleTracks: [], markers: undefined };
}

/** Where a sequence's content ends. */
export function sequenceDuration(p: Project, seqId: ID): number {
  const seq = p.sequences?.[seqId];
  return seq ? Math.max(0, ...seq.tracks.flatMap((t) => t.clips.map(end))) : 0;
}

/** Length of a clip's source: its media, or its sequence (undefined = unlimited, e.g. images). */
export function mediaDurationOf(p: Project, clip: Clip): number | undefined {
  if (clip.sequenceId) return sequenceDuration(p, clip.sequenceId);
  return clip.assetId ? p.assets[clip.assetId]?.duration : undefined;
}

/** Every clip, inside sequences too. */
export function allClips(p: Project): Clip[] {
  return [...p.tracks, ...Object.values(p.sequences ?? {}).flatMap((s) => s.tracks)].flatMap((t) => t.clips);
}

/** A deep copy of a sequence (new clip ids, nested sequences copied too). Returns the new id. */
export function cloneSequence(p: Project, seqId: ID, depth = 0): ID | undefined {
  const src = p.sequences?.[seqId];
  if (!src || depth > MAX_NEST) return undefined;
  const id = newId();
  const ids = new Map<ID, ID>();
  const tracks: Track[] = src.tracks.map((t) => ({
    ...t,
    id: newId(),
    clips: t.clips.map((c) => {
      const copy = { ...cloneClip(c), id: newId() };
      ids.set(c.id, copy.id);
      if (copy.sequenceId) copy.sequenceId = cloneSequence(p, copy.sequenceId, depth + 1);
      return copy;
    }),
  }));
  for (const t of tracks) if (t.transitions) t.transitions = t.transitions.map((x) => ({ ...x, id: newId(), fromClipId: ids.get(x.fromClipId)!, toClipId: ids.get(x.toClipId)! }));
  (p.sequences ??= {})[id] = { id, name: src.name, tracks };
  return id;
}

/**
 * Turn the selected clips into one compound clip at the earliest of them: each involved track
 * becomes a track inside it (same order), transitions between two selected clips go along. The
 * compound goes on the lowest involved visual track if there is room there, else on a new track.
 * Returns its id, or null when fewer than two clips can be combined.
 */
export function makeCompound(p: Project, ids: readonly ID[], name: string): ID | null {
  const picked = new Set(ids);
  const involved = p.tracks.filter((t) => !t.locked && t.clips.some((c) => picked.has(c.id)));
  const clips = involved.flatMap((t) => t.clips.filter((c) => picked.has(c.id)));
  if (clips.length < 2) return null;
  const t0 = Math.min(...clips.map((c) => c.start));
  const t1 = Math.max(...clips.map(end));
  const seqId = newId();
  const inner: Track[] = involved.map((t) => {
    const moved = t.clips.filter((c) => picked.has(c.id)).map((c) => ({ ...c, start: c.start - t0 }));
    const transitions = t.transitions?.filter((x) => picked.has(x.fromClipId) && picked.has(x.toClipId));
    t.clips = t.clips.filter((c) => !picked.has(c.id));
    if (t.transitions) t.transitions = t.transitions.filter((x) => !picked.has(x.fromClipId) && !picked.has(x.toClipId));
    return { id: newId(), kind: t.kind, muted: false, locked: false, clips: moved, ...(transitions?.length && { transitions }) };
  });
  (p.sequences ??= {})[seqId] = { id: seqId, name, tracks: inner };
  const visual = involved.some((t) => t.kind !== 'audio');
  const compound: Clip = {
    id: newId(),
    sequenceId: seqId,
    start: t0,
    duration: t1 - t0,
    inPoint: 0,
    speed: 1,
    transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
    audio: { volume: 1, fadeIn: 0, fadeOut: 0 },
  };
  const kind = visual ? 'video' : 'audio';
  const free = (t: Track) => t.kind === kind && !t.locked && t.clips.every((c) => end(c) <= t0 + EPS || c.start >= t1 - EPS);
  let target = involved.find(free);
  if (!target) {
    target = { id: newId(), kind, muted: false, locked: false, clips: [] };
    if (kind === 'audio') p.tracks.unshift(target);
    else p.tracks.push(target);
  }
  target.clips.push(compound);
  target.clips.sort((a, b) => a.start - b.start);
  return compound.id;
}

/**
 * The clips a compound shows, placed on the outer timeline: inner times shifted by start − inPoint,
 * cut to the compound's own span. Nested compounds are kept as clips (not expanded).
 */
function placedInner(p: Project, compound: Clip): { kind: Track['kind']; clips: Clip[] }[] {
  const seq = p.sequences?.[compound.sequenceId!];
  if (!seq) return [];
  const offset = compound.start - compound.inPoint;
  const a = compound.start;
  const b = end(compound);
  return seq.tracks.map((t) => ({
    kind: t.kind,
    clips: t.clips.flatMap((c) => {
      const s = c.start + offset;
      const e = s + c.duration;
      if (e <= a + EPS || s >= b - EPS) return [];
      const shifted = { ...c, start: s };
      return [s >= a - EPS && e <= b + EPS ? shifted : { ...shifted, ...retime(shifted, Math.max(a, s), Math.min(b, e)) }];
    }),
  }));
}

/** Put a compound's clips back on the timeline (on new tracks above it) and remove it. */
export function breakApart(p: Project, clipId: ID): boolean {
  const track = p.tracks.find((t) => t.clips.some((c) => c.id === clipId && c.sequenceId));
  if (!track || track.locked) return false;
  const compound = track.clips.find((c) => c.id === clipId)!;
  const groups = placedInner(p, compound);
  track.clips = track.clips.filter((c) => c.id !== clipId);
  const at = p.tracks.indexOf(track);
  const fresh: Track[] = groups.filter((g) => g.clips.length).map((g) => ({ id: newId(), kind: g.kind, muted: false, locked: false, clips: g.clips.sort((x, y) => x.start - y.start) }));
  // Visual tracks right above the compound's track (inner order kept); audio at the bottom.
  p.tracks.splice(at + 1, 0, ...fresh.filter((t) => t.kind !== 'audio'));
  p.tracks.unshift(...fresh.filter((t) => t.kind === 'audio'));
  return true;
}

/** After every edit: forget sequences no clip uses, and compound clips whose sequence is gone. */
export function normalizeSequences(p: Project) {
  const seqs = p.sequences;
  if (!seqs) return;
  const ids = new Set(Object.keys(seqs));
  const containers = [p.tracks, ...Object.values(seqs).map((s) => s.tracks)];
  for (const tracks of containers) for (const t of tracks) if (t.clips.some((c) => c.sequenceId && !ids.has(c.sequenceId))) t.clips = t.clips.filter((c) => !c.sequenceId || ids.has(c.sequenceId));
  // Reachable from the root timeline.
  const used = new Set<ID>();
  const visit = (tracks: Track[], depth: number) => {
    for (const t of tracks)
      for (const c of t.clips)
        if (c.sequenceId && !used.has(c.sequenceId) && depth < MAX_NEST + 1) {
          used.add(c.sequenceId);
          visit(seqs[c.sequenceId].tracks, depth + 1);
        }
  };
  visit(p.tracks, 0);
  for (const id of ids) if (!used.has(id)) delete seqs[id];
  if (!Object.keys(seqs).length) delete p.sequences;
}

const flatCache = new WeakMap<Project, Project>();

/**
 * The project with every compound expanded into plain clips on extra tracks (placed and cut as
 * they play), for what needs the media itself: audio (preview, export, speech-to-text, ducking)
 * and video decoding. Drawing still goes through the compounds (their effects, masks, transform).
 * The compound's volume multiplies its clips' volume; a muted track mutes what it holds.
 */
export function flattenForMedia(p: Project): Project {
  if (!p.sequences) return p;
  let flat = flatCache.get(p);
  if (!flat) {
    const out: Track[] = [];
    // A compound's tracks take the eye and solo of the root track that holds it.
    type Root = Pick<Track, 'hidden' | 'solo'>;
    const expand = (tracks: { kind: Track['kind']; muted?: boolean; hidden?: boolean; clips: Clip[] }[], gain: number, muted: boolean, root: Root, depth: number) => {
      for (const t of tracks) {
        const plain = t.clips.filter((c) => !c.sequenceId).map((c) => (gain === 1 ? c : { ...c, audio: { ...c.audio, volume: c.audio.volume * gain } }));
        const hidden = !!root.hidden || !!t.hidden;
        if (plain.length) out.push({ id: newId(), kind: t.kind, muted: muted || !!t.muted, locked: false, ...(hidden && { hidden }), ...(root.solo && { solo: true }), clips: plain });
        if (depth >= MAX_NEST) continue;
        for (const c of t.clips) if (c.sequenceId) expand(placedInner(p, c), gain * c.audio.volume, muted || !!t.muted, { ...root, hidden }, depth + 1);
      }
    };
    // Root tracks keep their identity (transitions, ids); compounds are taken out of them.
    for (const t of p.tracks) out.push(t.clips.some((c) => c.sequenceId) ? { ...t, clips: t.clips.filter((c) => !c.sequenceId) } : t);
    for (const t of p.tracks) for (const c of t.clips) if (c.sequenceId) expand(placedInner(p, c), c.audio.volume, !!t.muted, t, 1);
    flat = { ...p, tracks: out };
    flatCache.set(p, flat);
  }
  return flat;
}

/** The sequence the user is editing, if any (the last step of the edit path). */
export const openSequence = (path: readonly { sequenceId: ID }[]) => path.at(-1)?.sequenceId;

export type { Sequence };
