import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createProject, createTrack } from './factories';
import {
  addTextClip,
  canMove,
  clipEnd,
  copyClips,
  createClip,
  deleteClips,
  editPoints,
  findClip,
  insertClip,
  moveClips,
  nearestFreeStart,
  pasteClips,
  setClipSpeed,
  splitClips,
  trimClip,
  trimLimits,
} from './timeline';
import type { Asset, Project } from './types';

const video: Asset = { id: 'v', kind: 'video', name: 'v.mp4', duration: 10, fileRef: {} };
const image: Asset = { id: 'i', kind: 'image', name: 'i.png', fileRef: {} };

/** Video track with clips at [0,4) and [6,10) from a 10 s source; audio track empty. */
function setup() {
  const p = createProject('t');
  p.assets = { v: video, i: image };
  p.tracks = [createTrack('video'), createTrack('audio')];
  const [vt] = p.tracks;
  const a = { ...createClip(video, 0), id: 'a', duration: 4 };
  const b = { ...createClip(video, 6), id: 'b', duration: 4, inPoint: 2 };
  insertClip(vt, a);
  insertClip(vt, b);
  return p;
}
const clip = (p: Project, id: string) => findClip(p, id)!.clip;

describe('free space', () => {
  it('finds the nearest gap that fits', () => {
    const t = setup().tracks[0];
    expect(nearestFreeStart(t, 4.5, 2)).toBe(4); // gap [4,6) fits exactly
    expect(nearestFreeStart(t, 3, 3)).toBe(10); // gap too small -> after last clip
    expect(nearestFreeStart(t, -2, 1)).toBe(4);
  });
});

describe('splitClips', () => {
  it('splits at the given time and keeps source continuity', () => {
    const p = setup();
    const [rightId] = splitClips(p, 7, new Set(['b']));
    expect(clip(p, 'b')).toMatchObject({ start: 6, duration: 1, inPoint: 2 });
    expect(clip(p, rightId)).toMatchObject({ start: 7, duration: 3, inPoint: 3 });
    expect(p.tracks[0].clips.map((c) => c.start)).toEqual([0, 6, 7]);
  });

  it('splits everything under the playhead when nothing is selected, but not locked tracks', () => {
    const p = setup();
    const at = { ...createClip(image, 0), id: 'img', duration: 5 };
    p.tracks.push({ ...createTrack('video'), locked: true, clips: [at] });
    expect(splitClips(p, 2)).toHaveLength(1);
    expect(clip(p, 'img').duration).toBe(5);
  });

  it('refuses to create slivers shorter than the minimum', () => {
    const p = setup();
    expect(splitClips(p, 0.05)).toEqual([]);
    expect(splitClips(p, 6)).toEqual([]); // exactly on an edge
  });

  it('works on an Immer draft', () => {
    const p = produce(setup(), (d) => void splitClips(d, 2));
    expect(p.tracks[0].clips).toHaveLength(3);
  });
});

describe('trim', () => {
  it('limits the start edge by the previous clip and the source start', () => {
    const p = setup();
    // b has inPoint 2 -> can extend left by 2 s, i.e. to 4 (also the end of a)
    expect(trimLimits(p, 'b', 'start')).toEqual({ min: 4, max: 10 - 0.1 });
    expect(trimClip(p, 'b', 'start', 1)).toBe(4);
    expect(clip(p, 'b')).toMatchObject({ start: 4, duration: 6, inPoint: 0 });
  });

  it('limits the end edge by the next clip and the source end', () => {
    const p = setup();
    expect(trimLimits(p, 'a', 'end').max).toBe(6);
    expect(trimLimits(p, 'b', 'end').max).toBe(6 + (10 - 2)); // source has 8 s left
    trimClip(p, 'b', 'end', 99);
    expect(clipEnd(clip(p, 'b'))).toBe(14);
  });

  it('lets images be extended freely', () => {
    const p = setup();
    insertClip(p.tracks[0], { ...createClip(image, 20), id: 'img' });
    trimClip(p, 'img', 'end', 80);
    expect(clip(p, 'img').duration).toBe(60);
  });

  it('keeps speed in mind when trimming the start', () => {
    const p = setup();
    clip(p, 'b').speed = 2;
    trimClip(p, 'b', 'start', 7);
    expect(clip(p, 'b')).toMatchObject({ start: 7, duration: 3, inPoint: 4 });
  });
});

describe('move', () => {
  it('moves into a free spot and keeps the track sorted', () => {
    const p = setup();
    expect(moveClips(p, [{ clipId: 'a', trackId: p.tracks[0].id, start: 12 }])).toBe(true);
    expect(p.tracks[0].clips.map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('rejects overlaps, locked tracks and incompatible tracks', () => {
    const p = setup();
    const [vt, at] = p.tracks;
    expect(canMove(p, [{ clipId: 'a', trackId: vt.id, start: 5 }])).toBe(false);
    expect(canMove(p, [{ clipId: 'a', trackId: at.id, start: 20 }])).toBe(false);
    vt.locked = true;
    expect(canMove(p, [{ clipId: 'a', trackId: vt.id, start: 20 }])).toBe(false);
  });

  it('moves a selection together, ignoring collisions with itself', () => {
    const p = setup();
    const id = p.tracks[0].id;
    expect(
      moveClips(p, [
        { clipId: 'a', trackId: id, start: 2 },
        { clipId: 'b', trackId: id, start: 8 },
      ]),
    ).toBe(true);
    expect(p.tracks[0].clips.map((c) => c.start)).toEqual([2, 8]);
  });
});

describe('delete', () => {
  it('ripple delete closes the gap', () => {
    const p = setup();
    deleteClips(p, new Set(['a']), true);
    expect(p.tracks[0].clips.map((c) => [c.id, c.start])).toEqual([['b', 2]]);
  });

  it('plain delete leaves the gap', () => {
    const p = setup();
    deleteClips(p, new Set(['a']));
    expect(clip(p, 'b').start).toBe(6);
  });
});

describe('copy / paste', () => {
  it('pastes with relative timing at the playhead into free space', () => {
    const p = setup();
    const items = copyClips(p, new Set(['a', 'b']));
    const ids = pasteClips(p, items, 20);
    expect(ids).toHaveLength(2);
    expect(ids.map((id) => clip(p, id).start)).toEqual([20, 26]);
    expect(new Set(p.tracks[0].clips.map((c) => c.id)).size).toBe(4);
  });

  it('moves a pasted clip to the nearest free position when its spot is taken', () => {
    const p = setup();
    const [id] = pasteClips(p, copyClips(p, new Set(['a'])), 1);
    expect(clip(p, id).start).toBe(10);
  });
});

it('editPoints lists unique sorted edges', () => {
  expect(editPoints(setup())).toEqual([0, 4, 6, 10]);
});

describe('text clips and speed', () => {
  const text = {
    content: 'سلام', fontFamily: 'Vazirmatn', fontSize: 72, fontWeight: 700, color: '#fff',
    align: 'center' as const, rtl: true, fadeIn: 0, fadeOut: 0,
  };

  it('adds text on a free text track, creating one on top when needed', () => {
    const p = setup();
    const a = addTextClip(p, 1, text);
    expect(p.tracks.at(-1)!.kind).toBe('text');
    const b = addTextClip(p, 2, text); // overlaps a -> second text track
    expect(p.tracks.filter((t) => t.kind === 'text')).toHaveLength(2);
    const c = addTextClip(p, 10, text); // fits after a on the first text track
    expect(findClip(p, c)!.track).toBe(findClip(p, a)!.track);
    expect(findClip(p, b)!.clip.text!.content).toBe('سلام');
  });

  it('speed changes the timeline length but keeps the source range', () => {
    const p = setup();
    expect(setClipSpeed(p, 'b', 2)).toBe(2);
    expect(clip(p, 'b')).toMatchObject({ duration: 2, speed: 2, inPoint: 2 });
  });

  it('slowing down is limited by the next clip and the allowed range', () => {
    const p = setup();
    expect(setClipSpeed(p, 'a', 0.1)).toBe(0.5); // clamped
    expect(clip(p, 'a').duration).toBe(6); // would be 8, next clip starts at 6
  });
});
