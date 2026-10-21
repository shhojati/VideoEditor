import { describe, expect, it } from 'vitest';
import { useProjectStore } from '../store/projectStore';
import { createProject, createTrack } from './factories';
import { breakApart, flattenForMedia, makeCompound, normalizeSequences, sequenceDuration } from './sequences';
import { createClip, findClip, pasteClips, copyClips, splitClips, trimLimits } from './timeline';
import type { Asset } from './types';

const video: Asset = { id: 'v', kind: 'video', name: 'v.mp4', duration: 30, fileRef: {}, hasAudio: true };
const music: Asset = { id: 'm', kind: 'audio', name: 'm.mp3', duration: 60, fileRef: {} };

function setup() {
  const p = createProject('t');
  p.assets = { v: video, m: music };
  p.tracks = [createTrack('audio'), createTrack('video'), createTrack('video')];
  p.tracks[0].clips = [{ ...createClip(music, 0), id: 'm1', duration: 20 }];
  p.tracks[1].clips = [
    { ...createClip(video, 2), id: 'a', duration: 3 },
    { ...createClip(video, 5), id: 'b', inPoint: 4, duration: 3 },
    { ...createClip(video, 12), id: 'c', duration: 2 },
  ];
  p.tracks[2].clips = [{ ...createClip(video, 3), id: 'top', inPoint: 10, duration: 4 }];
  return p;
}

describe('makeCompound / breakApart', () => {
  it('moves the clips inside, keeping their relative times and layers', () => {
    const p = setup();
    const id = makeCompound(p, ['a', 'b', 'top'], 'C')!;
    const ref = findClip(p, id)!;
    expect(ref.track).toBe(p.tracks[1]);
    expect([ref.clip.start, ref.clip.duration]).toEqual([2, 6]);
    const seq = p.sequences![ref.clip.sequenceId!];
    expect(seq.tracks.map((t) => t.clips.map((c) => [c.id, c.start]))).toEqual([
      [
        ['a', 0],
        ['b', 3],
      ],
      [['top', 1]],
    ]);
    expect(p.tracks[2].clips).toEqual([]);
    expect(sequenceDuration(p, seq.id)).toBe(6);
    // Break apart: back on the timeline at the same times.
    breakApart(p, id);
    const all = p.tracks.flatMap((t) => t.clips).map((c) => [c.id, c.start]);
    expect(all).toEqual(expect.arrayContaining([['a', 2], ['b', 5], ['top', 3], ['c', 12]]));
    normalizeSequences(p);
    expect(p.sequences).toBeUndefined();
  });

  it('a trimmed compound shows only its part, and is limited by its sequence', () => {
    const p = setup();
    const id = makeCompound(p, ['a', 'b'], 'C')!;
    const c = findClip(p, id)!.clip;
    c.start += 1;
    c.inPoint = 1;
    c.duration = 3; // shows 1..4 of the sequence
    expect(trimLimits(p, id, 'end').max).toBeCloseTo(c.start + 5, 9); // sequence is 6 s long
    const flat = flattenForMedia(p);
    const placed = flat.tracks.flatMap((t) => t.clips).filter((x) => x.id === 'a' || x.id === 'b');
    expect(placed.map((x) => [x.id, x.start, x.duration])).toEqual([
      ['a', 3, 2],
      ['b', 5, 1],
    ]);
    expect(placed.find((x) => x.id === 'a')!.inPoint).toBeCloseTo(1, 9);
  });

  it('split and paste give each compound its own copy of the sequence', () => {
    const p = setup();
    const id = makeCompound(p, ['a', 'b'], 'C')!;
    const [right] = splitClips(p, 4, new Set([id]));
    const s1 = findClip(p, id)!.clip.sequenceId;
    const s2 = findClip(p, right)!.clip.sequenceId;
    expect(s1).not.toBe(s2);
    expect(Object.keys(p.sequences!)).toHaveLength(2);
    const innerIds = (sid: string) => p.sequences![sid].tracks.flatMap((t) => t.clips.map((c) => c.id));
    expect(innerIds(s1!).some((x) => innerIds(s2!).includes(x))).toBe(false);
    const [pasted] = pasteClips(p, copyClips(p, new Set([id])), 25);
    expect(Object.keys(p.sequences!)).toHaveLength(3);
    expect(findClip(p, pasted)!.clip.sequenceId).not.toBe(s1);
  });
});

describe('editing inside a compound', () => {
  it('edits go into the sequence; undo and the edit path follow', () => {
    const p = setup();
    const id = makeCompound(p, ['a', 'b'], 'C')!;
    const seqId = findClip(p, id)!.clip.sequenceId!;
    const store = useProjectStore.getState();
    store.load(p);
    useProjectStore.setState({ editPath: [{ clipId: id, sequenceId: seqId, outerTime: 0 }] });
    useProjectStore.getState().edit('test', (d) => {
      // The recipe sees the sequence as the timeline.
      expect(d.tracks.flatMap((t) => t.clips).map((c) => c.id)).toEqual(['a', 'b']);
      d.tracks[0].clips[0].duration = 1;
    });
    const after = useProjectStore.getState().history!.present;
    expect(after.sequences![seqId].tracks[0].clips[0].duration).toBe(1);
    expect(after.tracks[1].clips.map((c) => c.id)).toEqual([id, 'c']); // the main timeline is untouched
    // Breaking it apart from outside closes the opened compound.
    useProjectStore.setState({ editPath: [] });
    useProjectStore.getState().edit('break', (d) => void breakApart(d, id));
    expect(useProjectStore.getState().history!.present.sequences).toBeUndefined();
    useProjectStore.setState({ editPath: [{ clipId: id, sequenceId: seqId, outerTime: 0 }] });
    useProjectStore.getState().undo();
    expect(useProjectStore.getState().editPath).toHaveLength(1);
    useProjectStore.getState().redo();
    expect(useProjectStore.getState().editPath).toHaveLength(0);
  });
});
