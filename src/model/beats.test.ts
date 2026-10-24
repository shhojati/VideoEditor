import { describe, expect, it } from 'vitest';
import { clipBeats, cutToBeat, splitAtBeats, timelineBeats, toggleMarker } from './beats';
import { createProject, createTrack } from './factories';
import { createClip } from './timeline';
import type { Asset } from './types';

const music: Asset = { id: 'm', kind: 'audio', name: 'm.mp3', duration: 60, fileRef: {}, beats: { bpm: 120, times: Array.from({ length: 120 }, (_, i) => 0.25 + i * 0.5) } };
const photo: Asset = { id: 'p', kind: 'image', name: 'p.jpg', fileRef: {} };
const video: Asset = { id: 'v', kind: 'video', name: 'v.mp4', duration: 1.2, fileRef: {} };

function setup() {
  const p = createProject('t');
  p.assets = { m: music, p: photo, v: video };
  p.tracks = [createTrack('audio'), createTrack('video')];
  // Music from 2 s, playing its source from 1 s: beats land at 2.25, 2.75, …
  p.tracks[0].clips = [{ ...createClip(music, 2), id: 'music', inPoint: 1, duration: 20 }];
  p.tracks[1].clips = [
    { ...createClip(photo, 2.2), id: 'a', duration: 3 },
    { ...createClip(video, 5.2), id: 'b' },
    { ...createClip(photo, 6.4), id: 'c', duration: 1 },
  ];
  return p;
}

describe('beats on the timeline', () => {
  it('maps a clip’s beats through its in-point and speed', () => {
    const p = setup();
    const clip = p.tracks[0].clips[0];
    expect(clipBeats(p, clip).slice(0, 3)).toEqual([2.25, 2.75, 3.25]);
    clip.speed = 2;
    clip.duration = 10;
    expect(clipBeats(p, clip).slice(0, 3)).toEqual([2.125, 2.375, 2.625]);
    p.tracks[0].muted = true;
    expect(timelineBeats(p)).toEqual([]);
  });
});

describe('cutToBeat', () => {
  it('lays clips end to end on every 2nd beat; a short video takes fewer beats', () => {
    const p = setup();
    expect(cutToBeat(p, ['a', 'b', 'c'], 2)).toEqual({ ok: true, count: 3 });
    const [a, b, c] = p.tracks[1].clips;
    expect([a.start, a.duration]).toEqual([2.25, 1]);
    expect([b.start, b.duration]).toEqual([3.25, 1]);
    expect([c.start, c.duration]).toEqual([4.25, 1]);
    // Every 4 beats: the video only has room for 2.
    const q = setup();
    cutToBeat(q, ['a', 'b', 'c'], 4);
    expect(q.tracks[1].clips.map((x) => [x.start, x.duration])).toEqual([
      [2.25, 2],
      [4.25, 1],
      [5.25, 2],
    ]);
  });

  it('refuses without beats, without media clips, or over another clip', () => {
    const p = setup();
    p.tracks[0].muted = true;
    expect(cutToBeat(p, ['a'], 1)).toEqual({ ok: false, reason: 'noBeats' });
    expect(cutToBeat(setup(), ['music'], 1)).toEqual({ ok: false, reason: 'noClips' });
    const q = setup();
    expect(cutToBeat(q, ['a'], 8)).toEqual({ ok: false, reason: 'blocked' }); // would run into b
    expect(q.tracks[1].clips[0].duration).toBe(3);
  });
});

describe('toggleMarker', () => {
  it('adds sorted markers and removes one close to the time', () => {
    const p = setup();
    expect(toggleMarker(p, 3, 0.05)).toBe(true);
    toggleMarker(p, 1, 0.05);
    expect(p.markers!.map((m) => m.t)).toEqual([1, 3]);
    expect(toggleMarker(p, 3.02, 0.05)).toBe(false);
    expect(p.markers!.map((m) => m.t)).toEqual([1]);
  });
});

describe('splitAtBeats (cut to beat)', () => {
  it('cuts a clip at every beat inside it, in one go', () => {
    const p = setup();
    // Photo a: 2.2–5.2 s; beats at 2.25, 2.75 … 4.75 (2.25 is less than a minimum clip from the start).
    expect(splitAtBeats(p, ['a'], 1)).toEqual({ ok: true, count: 5 });
    const pieces = p.tracks[1].clips.filter((c) => c.start < 5.2);
    expect(pieces.map((c) => c.start)).toEqual([2.2, 2.75, 3.25, 3.75, 4.25, 4.75]);
    expect(pieces[0].id).toBe('a');
    expect(pieces.at(-1)!.start + pieces.at(-1)!.duration).toBeCloseTo(5.2);
  });

  it('takes every Nth beat, starting from the first one in the clip', () => {
    const p = setup();
    expect(splitAtBeats(p, ['a'], 2)).toEqual({ ok: true, count: 3 });
    expect(p.tracks[1].clips.filter((c) => c.start < 5.2).map((c) => c.start)).toEqual([2.2, 2.75, 3.75, 4.75]);
  });

  it('uses the selected clip’s own beats (a music video)', () => {
    const p = setup();
    p.tracks[0].clips = [];
    p.assets.v = { ...video, duration: 10, beats: { bpm: 60, times: [1, 2, 3, 4] } };
    p.tracks[1].clips = [{ ...createClip(p.assets.v, 0), id: 'mv', duration: 10 }];
    expect(splitAtBeats(p, ['mv'], 1)).toEqual({ ok: true, count: 4 });
    expect(p.tracks[1].clips.map((c) => [c.start, c.inPoint])).toEqual([[0, 0], [1, 1], [2, 2], [3, 3], [4, 4]]);
  });

  it('says why nothing was cut', () => {
    const p = setup();
    expect(splitAtBeats(p, [], 1)).toEqual({ ok: false, reason: 'noClips' });
    p.tracks[1].clips.push({ ...createClip(photo, 30), id: 'late', duration: 0.15 });
    expect(splitAtBeats(p, ['late'], 1)).toEqual({ ok: false, reason: 'noCuts' });
    p.tracks[0].muted = true;
    expect(splitAtBeats(p, ['a'], 1)).toEqual({ ok: false, reason: 'noBeats' });
  });
});
