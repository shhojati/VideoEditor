// Transitions between touching clips. Pure functions on the project document, like timeline.ts.
import { newId } from './factories';
import type { Clip, ID, Project, Track, Transition, TransitionKind } from './types';

export const TRANSITION_KINDS: TransitionKind[] = [
  'crossfade',
  'dipBlack',
  'dipWhite',
  'wipeLeft',
  'wipeRight',
  'wipeUp',
  'wipeDown',
  'slideLeft',
  'slideRight',
  'pushLeft',
  'pushRight',
  'zoomIn',
  'zoomOut',
  'blur',
];

/** Audio tracks only crossfade; picture tracks take every kind. */
export const kindsFor = (track: Pick<Track, 'kind'>): TransitionKind[] => (track.kind === 'audio' ? ['crossfade'] : TRANSITION_KINDS);

export const DEFAULT_TRANSITION_DURATION = 0.5;
export const MIN_TRANSITION_DURATION = 0.1;
export const MAX_TRANSITION_DURATION = 3;
/** Clips count as touching when the gap at the cut is below this (s). */
const TOUCH = 1e-3;

export const cutTime = (from: Clip) => from.start + from.duration;

export interface CutRef {
  track: Track;
  from: Clip;
  to: Clip;
  transition?: Transition;
}

/** Every cut between touching clips on every track. */
export function cutsOf(p: Project): CutRef[] {
  const out: CutRef[] = [];
  for (const track of p.tracks) {
    for (let i = 0; i + 1 < track.clips.length; i++) {
      const from = track.clips[i];
      const to = track.clips[i + 1];
      if (Math.abs(to.start - cutTime(from)) > TOUCH) continue;
      out.push({ track, from, to, transition: track.transitions?.find((t) => t.fromClipId === from.id && t.toClipId === to.id) });
    }
  }
  return out;
}

export function findTransition(p: Project, id: ID): { track: Track; transition: Transition } | undefined {
  for (const track of p.tracks) {
    const transition = track.transitions?.find((t) => t.id === id);
    if (transition) return { track, transition };
  }
  return undefined;
}

/** The transitions entering (`in`) and leaving (`out`) a clip. */
export function transitionsOfClip(track: Track, clipId: ID): { in?: Transition; out?: Transition } {
  return {
    in: track.transitions?.find((t) => t.toClipId === clipId),
    out: track.transitions?.find((t) => t.fromClipId === clipId),
  };
}

/**
 * Longest allowed transition on a cut: each half must fit inside its clip next to whatever
 * transition that clip has on its other side.
 */
export function maxTransitionDuration(track: Track, from: Clip, to: Clip): number {
  const fromIn = transitionsOfClip(track, from.id).in?.duration ?? 0;
  const toOut = transitionsOfClip(track, to.id).out?.duration ?? 0;
  const half = Math.min(from.duration - fromIn / 2, to.duration - toOut / 2);
  return Math.max(0, Math.min(MAX_TRANSITION_DURATION, 2 * half));
}

/** Add (or replace) the transition on the cut between two clips. Returns its id, or null if impossible. */
export function setTransition(p: Project, fromClipId: ID, toClipId: ID, kind: TransitionKind, duration = DEFAULT_TRANSITION_DURATION): ID | null {
  const cut = cutsOf(p).find((c) => c.from.id === fromClipId && c.to.id === toClipId);
  if (!cut || cut.track.locked || !kindsFor(cut.track).includes(kind)) return null;
  const others = (cut.track.transitions ?? []).filter((t) => t !== cut.transition);
  const max = maxTransitionDuration({ ...cut.track, transitions: others }, cut.from, cut.to);
  if (max < MIN_TRANSITION_DURATION) return null;
  const transition: Transition = {
    id: cut.transition?.id ?? newId(),
    kind,
    duration: Math.min(max, Math.max(MIN_TRANSITION_DURATION, duration)),
    fromClipId,
    toClipId,
  };
  cut.track.transitions = [...others, transition];
  return transition.id;
}

export function updateTransition(p: Project, id: ID, patch: Partial<Pick<Transition, 'kind' | 'duration'>>) {
  const ref = findTransition(p, id);
  if (!ref || ref.track.locked) return;
  const { track, transition } = ref;
  if (patch.kind && kindsFor(track).includes(patch.kind)) transition.kind = patch.kind;
  if (patch.duration !== undefined) {
    const from = track.clips.find((c) => c.id === transition.fromClipId)!;
    const to = track.clips.find((c) => c.id === transition.toClipId)!;
    const others = { ...track, transitions: track.transitions!.filter((t) => t !== transition) };
    transition.duration = Math.min(maxTransitionDuration(others, from, to), Math.max(MIN_TRANSITION_DURATION, patch.duration));
  }
}

export function removeTransitions(p: Project, ids: ReadonlySet<ID>) {
  for (const track of p.tracks) if (track.transitions) track.transitions = track.transitions.filter((t) => !ids.has(t.id));
}

/**
 * Keep transitions valid after any edit: drop those whose clips are gone or no longer touch, and
 * shorten those that no longer fit. Runs after every project edit (store/projectStore.ts).
 */
export function normalizeTransitions(p: Project) {
  for (const track of p.tracks) {
    if (!track.transitions?.length) continue;
    const kept: Transition[] = [];
    for (const t of track.transitions) {
      const i = track.clips.findIndex((c) => c.id === t.fromClipId);
      const from = track.clips[i];
      const to = track.clips[i + 1];
      if (!from || !to || to.id !== t.toClipId || Math.abs(to.start - cutTime(from)) > TOUCH) continue;
      if (!kindsFor(track).includes(t.kind)) continue;
      kept.push(t);
    }
    // Shorten in order so neighbours on the same clip share it fairly.
    for (const t of kept) {
      const from = track.clips.find((c) => c.id === t.fromClipId)!;
      const to = track.clips.find((c) => c.id === t.toClipId)!;
      const max = maxTransitionDuration({ ...track, transitions: kept.filter((x) => x !== t) }, from, to);
      if (t.duration > max) t.duration = max;
    }
    const valid = kept.filter((t) => t.duration >= MIN_TRANSITION_DURATION - 1e-9);
    // Only reassign when something was dropped (filter keeps order and identity), so unrelated
    // edits do not record a change here and no-op edits stay no-ops.
    if (valid.length !== track.transitions.length) track.transitions = valid.length ? valid : undefined;
  }
}

/** Timeline interval in which a clip is visible/audible, including transition overlaps. */
export function clipVisibleRange(track: Track, clip: Clip): { start: number; end: number } {
  const { in: tin, out } = transitionsOfClip(track, clip.id);
  return { start: clip.start - (tin?.duration ?? 0) / 2, end: clip.start + clip.duration + (out?.duration ?? 0) / 2 };
}

/** Source time shown at timeline time t, extended past the trim points for transitions. */
export const extendedSourceTime = (clip: Clip, t: number) => clip.inPoint + (t - clip.start) * clip.speed;
