import { describe, expect, it } from 'vitest';
import { rippleDeleteRange, rippleDeleteRanges } from './cut';
import { createProject, createSubtitleTrack, createTrack } from './factories';
import { mediaTimeAt } from './remap';
import { createClip } from './timeline';
import { isFiller, silences, timelineWords } from './transcript';
import type { Asset, Clip } from './types';

const video: Asset = { id: 'v', kind: 'video', name: 'v.mp4', duration: 30, fileRef: {} };
const music: Asset = { id: 'm', kind: 'audio', name: 'm.mp3', duration: 60, fileRef: {} };

function setup() {
  const p = createProject('t');
  p.assets = { v: video, m: music };
  p.tracks = [createTrack('audio'), createTrack('video'), createTrack('text')];
  // Video 0–10 (source 5–15), music 0–20, a title 3–5, a locked track's clip.
  p.tracks[1].clips = [{ ...createClip(video, 0), id: 'v1', inPoint: 5, duration: 10 }];
  p.tracks[0].clips = [{ ...createClip(music, 0), id: 'm1', duration: 20 }];
  const title: Clip = { ...createClip(video, 3), id: 't1', assetId: undefined, duration: 2, text: { content: 'Hi' } as Clip['text'] };
  p.tracks[2].clips = [title];
  const st = createSubtitleTrack('fa');
  st.cues = [
    { id: 'c1', start: 1, end: 2.5, text: 'a' },
    { id: 'c2', start: 2.8, end: 3.4, text: 'b' },
    { id: 'c3', start: 6, end: 7, text: 'c' },
  ];
  p.subtitleTracks.push(st);
  p.markers = [{ id: 'k1', t: 2.9 }, { id: 'k2', t: 8 }];
  return p;
}

describe('rippleDeleteRange', () => {
  it('cuts every track, closes the gap and keeps frames in place', () => {
    const p = setup();
    expect(rippleDeleteRange(p, 2, 4)).toBe(2);
    const v = p.tracks[1].clips;
    expect(v.map((c) => [c.start, c.duration])).toEqual([
      [0, 2],
      [2, 6],
    ]);
    // The part after the cut shows what was at 4 s.
    expect(mediaTimeAt(v[1], 2)).toBeCloseTo(9, 9);
    expect(p.tracks[0].clips.map((c) => [c.start, c.duration])).toEqual([
      [0, 2],
      [2, 16],
    ]);
    // The title (3–5) loses its first second and moves to 2.
    expect(p.tracks[2].clips.map((c) => [c.start, c.duration])).toEqual([[2, 1]]);
    // Cues: c1 shortened, c2 inside → gone, c3 moved.
    expect(p.subtitleTracks[0].cues.map((c) => [c.id, c.start, c.end])).toEqual([
      ['c1', 1, 2],
      ['c3', 4, 5],
    ]);
    expect(p.markers!.map((m) => m.t)).toEqual([6]);
  });

  it('leaves locked tracks alone and handles several ranges at once', () => {
    const p = setup();
    p.tracks[0].locked = true;
    rippleDeleteRanges(p, [
      [6, 7],
      [1, 2],
      [1.5, 2.5],
    ]);
    expect(p.tracks[0].clips.map((c) => [c.start, c.duration])).toEqual([[0, 20]]);
    expect(p.tracks[1].clips.reduce((n, c) => n + c.duration, 0)).toBeCloseTo(7.5, 9);
  });
});

describe('transcripts', () => {
  const clip: Clip = {
    ...createClip(video, 2),
    inPoint: 1,
    duration: 6,
    transcript: {
      language: 'en',
      rtl: false,
      words: [
        { text: 'Hello', s: 1.5, e: 2 },
        { text: 'um,', s: 2.1, e: 2.4 },
        { text: 'world.', s: 4, e: 4.5 },
        { text: 'later', s: 9, e: 9.5 }, // after the clip
      ],
    },
  };

  it('lists the words the clip plays, in timeline time', () => {
    expect(timelineWords(clip).map((w) => [w.text, w.start, w.end])).toEqual([
      ['Hello', 2.5, 3],
      ['um,', 3.1, 3.4],
      ['world.', 5, 5.5],
    ]);
  });

  it('finds fillers in both languages', () => {
    expect(isFiller('um,', 'en', false)).toBe(true);
    expect(isFiller('Umm!', 'en', false)).toBe(true);
    expect(isFiller('like', 'en', false)).toBe(false);
    expect(isFiller('like', 'en', true)).toBe(true);
    expect(isFiller('اِم', 'fa', false)).toBe(true);
    expect(isFiller('یعنی،', 'fa', true)).toBe(true);
    expect(isFiller('سلام', 'fa', true)).toBe(false);
  });

  it('finds pauses, keeping a little room next to the words', () => {
    // Clip 2–8; words 2.5–3, 3.1–3.4, 5–5.5.
    expect(silences(clip, 0.6)).toEqual([
      [expect.closeTo(3.5), expect.closeTo(4.9)],
      [expect.closeTo(5.6), 8],
    ]);
  });
});
