// Compound clips: several clips become one clip whose content is a nested timeline (a sequence in
// Project.sequences). Each compound clip owns its sequence (copies and splits copy it), so every
// inner clip exists exactly once and keeps a unique id. Like timeline.ts, edits mutate the project
// inside edit().
import { newId } from './factories';
import { keyedClip } from './keyframes';
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
 *
 * `group` (Group, the agent's group_clips): it goes where the lowest of the clips was in the stack
 * instead, tracks it left empty are removed, and it pivots about `group.pivot` (see recentre).
 */
export function makeCompound(p: Project, ids: readonly ID[], name: string, group?: { pivot?: { x: number; y: number } }): ID | null {
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
    const lowest = involved.find((t) => t.kind !== 'audio');
    if (kind === 'audio') p.tracks.unshift(target);
    else if (group && lowest) p.tracks.splice(p.tracks.indexOf(lowest), 0, target);
    else p.tracks.push(target);
  }
  target.clips.push(compound);
  target.clips.sort((a, b) => a.start - b.start);
  if (group) {
    dropEmpty(p, involved);
    if (group.pivot && visual) recentre(p, compound, inner, group.pivot);
  }
  return compound.id;
}

/**
 * Group pivot: move the insides so `pivot` (project px, the clips' bounding-box centre) is the middle
 * of the compound's frame, and the compound by as much the other way. Nothing changes on screen, but
 * the compound now scales and turns about its content. Clips parented to another clip inside follow
 * their parent. Callers pass a pivot only when the content fits in the frame (the compound's layer
 * is frame-sized and would cut it).
 */
function recentre(p: Project, compound: Clip, inner: Track[], pivot: { x: number; y: number }) {
  const { width: W, height: H } = p.settings;
  const dx = (pivot.x - W / 2) / W;
  const dy = (pivot.y - H / 2) / H;
  if (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6) return;
  const ids = new Set(inner.flatMap((t) => t.clips.map((c) => c.id)));
  for (const t of inner)
    for (const c of t.clips) {
      if (t.kind === 'audio' || (c.parentId && ids.has(c.parentId))) continue;
      c.transform.x -= dx;
      c.transform.y -= dy;
      for (const k of c.keyframes ?? []) {
        if (k.v.x !== undefined) k.v.x -= dx;
        if (k.v.y !== undefined) k.v.y -= dy;
      }
    }
  compound.transform.x = dx;
  compound.transform.y = dy;
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

const RAD = Math.PI / 180;

/** Remove these tracks where they are empty, while another track of their kind remains. */
function dropEmpty(p: Project, tracks: Track[]) {
  for (const t of tracks) if (!t.clips.length && p.tracks.some((o) => o !== t && o.kind === t.kind)) p.tracks.splice(p.tracks.indexOf(t), 1);
}

/**
 * Fold the compound's position, turn, scale and opacity (at its start) and its volume into the
 * clips it held, so they stay where they were drawn. Clips parented to another clip inside follow
 * their parent. Returns false when that cannot be exact: the compound's own keyframes, effects,
 * masks, blend mode or crop are not carried over.
 */
function bake(p: Project, compound: Clip, groups: { kind: Track['kind']; clips: Clip[] }[]): boolean {
  const { width: W, height: H } = p.settings;
  const tr = keyedClip(compound, compound.start).transform;
  const a = tr.rotation * RAD;
  const place = (x: number, y: number) => {
    const lx = x * W * tr.scale;
    const ly = y * H * tr.scale;
    return { x: tr.x + (lx * Math.cos(a) - ly * Math.sin(a)) / W, y: tr.y + (lx * Math.sin(a) + ly * Math.cos(a)) / H };
  };
  const ids = new Set(groups.flatMap((g) => g.clips.map((c) => c.id)));
  for (const g of groups)
    for (const c of g.clips) {
      c.audio = { ...c.audio, volume: c.audio.volume * compound.audio.volume };
      if (g.kind === 'audio') continue;
      const own = !(c.parentId && ids.has(c.parentId));
      const local = c.transform;
      const t = { ...local };
      if (own) {
        Object.assign(t, place(t.x, t.y));
        t.rotation += tr.rotation;
        t.scale *= tr.scale;
      }
      t.opacity *= tr.opacity;
      c.transform = t;
      c.keyframes = c.keyframes?.map((k) => {
        const v = { ...k.v };
        if (own && (v.x !== undefined || v.y !== undefined)) Object.assign(v, place(v.x ?? local.x, v.y ?? local.y));
        if (own && v.rotation !== undefined) v.rotation += tr.rotation;
        if (own && v.scale !== undefined) v.scale *= tr.scale;
        if (v.opacity !== undefined) v.opacity *= tr.opacity;
        return { ...k, v };
      });
      if (!c.keyframes) delete c.keyframes;
    }
  const keyed = compound.keyframes?.some((k) => ['x', 'y', 'scale', 'rotation', 'opacity'].some((q) => q in k.v));
  return !keyed && !compound.effects?.length && !compound.masks?.length && (compound.blend ?? 'normal') === 'normal' && !compound.transform.crop;
}

/**
 * Put a compound's clips back on the timeline (on new tracks above it) and remove it, keeping them
 * where they were drawn (see bake). Returns false when it is not a compound (or is locked); 'approx'
 * when the compound had settings that could not be carried over to its clips.
 */
export function breakApart(p: Project, clipId: ID): boolean | 'approx' {
  const track = p.tracks.find((t) => t.clips.some((c) => c.id === clipId && c.sequenceId));
  if (!track || track.locked) return false;
  const compound = track.clips.find((c) => c.id === clipId)!;
  const groups = placedInner(p, compound);
  const exact = bake(p, compound, groups);
  track.clips = track.clips.filter((c) => c.id !== clipId);
  const at = p.tracks.indexOf(track);
  const fresh: Track[] = groups.filter((g) => g.clips.length).map((g) => ({ id: newId(), kind: g.kind, muted: false, locked: false, clips: g.clips.sort((x, y) => x.start - y.start) }));
  // Visual tracks right above the compound's track (inner order kept); audio at the bottom.
  p.tracks.splice(at + 1, 0, ...fresh.filter((t) => t.kind !== 'audio'));
  p.tracks.unshift(...fresh.filter((t) => t.kind === 'audio'));
  dropEmpty(p, [track]);
  return exact || 'approx';
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
