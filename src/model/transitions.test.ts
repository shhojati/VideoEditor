import { describe, expect, it } from 'vitest';
import { createProject, createTrack } from './factories';
import { createClip, deleteClips, insertClip, moveClips, splitClips, trimClip } from './timeline';
import {
  clipVisibleRange,
  cutsOf,
  findTransition,
  maxTransitionDuration,
  normalizeTransitions,
  setTransition,
  updateTransition,
} from './transitions';
import type { Asset, Project } from './types';

const video: Asset = { id: 'v', kind: 'video', name: 'v', duration: 20, fileRef: {} };
const audio: Asset = { id: 'a', kind: 'audio', name: 'a', duration: 20, fileRef: {} };

/** Video track: a [0,4) b [4,8) c [9,12) (gap before c); audio track: x [0,5) y [5,10). */
function setup(): Project {
  const p = createProject('t');
  p.assets = { v: video, a: audio };
  const vt = createTrack('video');
  const at = createTrack('audio');
  p.tracks = [at, vt];
  insertClip(vt, { ...createClip(video, 0), id: 'a', duration: 4 });
  insertClip(vt, { ...createClip(video, 4), id: 'b', duration: 4 });
  insertClip(vt, { ...createClip(video, 9), id: 'c', duration: 3 });
  insertClip(at, { ...createClip(audio, 0), id: 'x', duration: 5 });
  insertClip(at, { ...createClip(audio, 5), id: 'y', duration: 5 });
  return p;
}
const edit = (p: Project, f: (p: Project) => void) => {
  f(p);
  normalizeTransitions(p);
};
const transitionsOf = (p: Project) => p.tracks.flatMap((t) => t.transitions ?? []);

describe('cuts and adding', () => {
  it('finds only cuts between touching clips', () => {
    expect(cutsOf(setup()).map((c) => `${c.from.id}>${c.to.id}`)).toEqual(['x>y', 'a>b']);
  });

  it('adds a transition with the default duration, replaces it on the same cut', () => {
    const p = setup();
    const id = setTransition(p, 'a', 'b', 'crossfade')!;
    expect(findTransition(p, id)!.transition).toMatchObject({ kind: 'crossfade', duration: 0.5 });
    expect(setTransition(p, 'a', 'b', 'wipeLeft', 1)).toBe(id);
    expect(transitionsOf(p)).toEqual([{ id, kind: 'wipeLeft', duration: 1, fromClipId: 'a', toClipId: 'b' }]);
  });

  it('refuses clips that do not touch, and picture kinds on audio tracks', () => {
    const p = setup();
    expect(setTransition(p, 'b', 'c', 'crossfade')).toBeNull();
    expect(setTransition(p, 'x', 'y', 'wipeLeft')).toBeNull();
    expect(setTransition(p, 'x', 'y', 'crossfade')).not.toBeNull();
  });

  it('caps the duration so both halves fit beside the other transitions', () => {
    const p = setup();
    setTransition(p, 'a', 'b', 'crossfade', 100);
    expect(transitionsOf(p)[0].duration).toBe(3); // MAX_TRANSITION_DURATION
    const track = p.tracks[1];
    expect(maxTransitionDuration(track, track.clips[0], track.clips[1])).toBe(3);
    updateTransition(p, transitionsOf(p)[0].id, { duration: 0.01 });
    expect(transitionsOf(p)[0].duration).toBe(0.1);
  });

  it('extends the visible range of both clips by half the duration', () => {
    const p = setup();
    setTransition(p, 'a', 'b', 'crossfade', 1);
    const [a, b] = p.tracks[1].clips;
    expect(clipVisibleRange(p.tracks[1], a)).toEqual({ start: 0, end: 4.5 });
    expect(clipVisibleRange(p.tracks[1], b)).toEqual({ start: 3.5, end: 8 });
  });
});

describe('staying valid after edits', () => {
  it('drops the transition when the clips are moved apart or one is deleted', () => {
    const p = setup();
    setTransition(p, 'a', 'b', 'crossfade');
    edit(p, (d) => moveClips(d, [{ clipId: 'b', trackId: d.tracks[1].id, start: 4.5 }]));
    expect(transitionsOf(p)).toEqual([]);

    const q = setup();
    setTransition(q, 'a', 'b', 'crossfade');
    edit(q, (d) => deleteClips(d, new Set(['a'])));
    expect(transitionsOf(q)).toEqual([]);
  });

  it('shortens a transition that no longer fits after a trim', () => {
    const p = setup();
    setTransition(p, 'a', 'b', 'crossfade', 2);
    edit(p, (d) => trimClip(d, 'b', 'end', 4.6)); // b is now 0.6 s long
    expect(transitionsOf(p)[0].duration).toBeCloseTo(1.2);
  });

  it('keeps the transition on the right part when the outgoing clip is split', () => {
    const p = setup();
    setTransition(p, 'a', 'b', 'crossfade');
    let right = '';
    edit(p, (d) => void ([right] = splitClips(d, 2, new Set(['a']))));
    expect(transitionsOf(p)[0]).toMatchObject({ fromClipId: right, toClipId: 'b' });
  });

  it('does not touch the document when nothing about transitions changed', () => {
    const p = setup();
    setTransition(p, 'a', 'b', 'crossfade');
    const before = p.tracks[1].transitions;
    normalizeTransitions(p);
    expect(p.tracks[1].transitions).toBe(before);
  });
});
