import { describe, expect, it } from 'vitest';
import { createProject, createTrack } from '../../model/factories';
import { addTextClip, createClip, insertClip } from '../../model/timeline';
import type { Asset, Clip, MotionLink, Project, TextProps, Tracker, TrackSample } from '../../model/types';
import {
  baseFromDrawn,
  boxToSample,
  mergeSamples,
  motionTransform,
  normalizeMotion,
  putSample,
  sampleAt,
  trackerBox,
} from './motion';

const TEXT: TextProps = { content: 'Hi', fontFamily: 'Vazirmatn', fontSize: 60, fontWeight: 400, color: '#fff', align: 'center', rtl: false, fadeIn: 0, fadeOut: 0 };
const asset: Asset = { id: 'a', kind: 'video', name: 'v.mp4', duration: 10, width: 1920, height: 1080, fileRef: {} };

/** A 1920×1080 project with the video full-frame (1 canvas px = 1 source px) and a text clip. */
function setup(samples: TrackSample[]): { p: Project; video: Clip; text: Clip; tracker: Tracker } {
  const p = createProject('t');
  p.assets.a = asset;
  const video = createClip(asset, 0);
  const tracker: Tracker = { id: 'tr', name: 'Object 1', width: 0.1, height: 0.1, samples };
  video.trackers = [tracker];
  insertClip(p.tracks.find((t) => t.kind === 'video')!, video);
  const textId = addTextClip(p, 0, TEXT);
  const text = p.tracks.flatMap((t) => t.clips).find((c) => c.id === textId)!;
  return { p, video, text, tracker };
}

const link = (over: Partial<MotionLink> = {}): MotionLink => ({ clipId: 'v', trackerId: 'tr', mode: 'follow', position: true, rotation: false, scale: false, ref: 0, ...over });
const px = (p: Project, c: Clip, t: number) => {
  const tr = motionTransform(p, c, t);
  return { x: 960 + tr.x * 1920, y: 540 + tr.y * 1080, rotation: tr.rotation, scale: tr.scale };
};

describe('sampleAt', () => {
  const tracker: Tracker = { id: 'x', name: '', width: 0.1, height: 0.1, samples: [[1, 0.2, 0.2, 0, 1], [2, 0.4, 0.6, 90, 3]] };
  it('interpolates linearly and holds outside the range', () => {
    expect(sampleAt(tracker, 1.5)).toEqual([1.5, 0.30000000000000004, 0.4, 45, 2]);
    expect(sampleAt(tracker, 0)).toEqual(tracker.samples[0]);
    expect(sampleAt(tracker, 5)).toEqual(tracker.samples[1]);
  });
});

describe('follow', () => {
  // The object moves 192 px right and 108 px down over 1 s, turns 90° and doubles in size.
  const samples: TrackSample[] = [[0, 0.5, 0.5, 0, 1], [1, 0.6, 0.6, 90, 2]];

  it('position only: moves by the object’s displacement', () => {
    const { p, video, text } = setup(samples);
    text.transform = { ...text.transform, x: 0.1, y: 0 };
    text.motion = link({ clipId: video.id });
    expect(px(p, text, 0)).toMatchObject({ x: 1152, y: 540, rotation: 0, scale: 1 });
    const at1 = px(p, text, 1);
    expect(at1.x).toBeCloseTo(1152 + 192);
    expect(at1.y).toBeCloseTo(540 + 108);
    // Half way: interpolated.
    expect(px(p, text, 0.5).x).toBeCloseTo(1152 + 96);
  });

  it('position + rotation + scale: orbits the object and turns / grows with it', () => {
    const { p, video, text } = setup(samples);
    text.transform = { ...text.transform, x: 0.1, y: 0, scale: 0.5, rotation: 10 };
    text.motion = link({ clipId: video.id, rotation: true, scale: true });
    const at1 = px(p, text, 1);
    // Offset (+192, 0) from the object, turned 90° clockwise and doubled: (0, +384).
    expect(at1.x).toBeCloseTo(960 + 192);
    expect(at1.y).toBeCloseTo(540 + 108 + 384);
    expect(at1.rotation).toBeCloseTo(100);
    expect(at1.scale).toBeCloseTo(1);
  });

  it('rotation / scale without position turn the clip about its own centre', () => {
    const { p, video, text } = setup(samples);
    text.motion = link({ clipId: video.id, position: false, rotation: true, scale: true });
    const at1 = px(p, text, 1);
    expect([at1.x, at1.y]).toEqual([960, 540 + 0.3 * 1080]);
    expect(at1.rotation).toBeCloseTo(90);
    expect(at1.scale).toBeCloseTo(2);
  });

  it('applies the reference time: no jump at the frame where it was linked', () => {
    const { p, video, text } = setup(samples);
    text.motion = link({ clipId: video.id, ref: 1, rotation: true, scale: true });
    expect(motionTransform(p, text, 1)).toEqual(expect.objectContaining({ x: text.transform.x, rotation: 0, scale: 1 }));
    expect(px(p, text, 1).y).toBeCloseTo(540 + 0.3 * 1080);
  });

  it('follows the tracked clip’s placement on the canvas (scaled video)', () => {
    const { p, video, text } = setup(samples);
    video.transform.scale = 0.5;
    text.motion = link({ clipId: video.id });
    expect(px(p, text, 1).x - px(p, text, 0).x).toBeCloseTo(96);
  });

  it('baseFromDrawn inverts the motion', () => {
    const { p, video, text } = setup(samples);
    text.transform = { ...text.transform, x: 0.05, y: -0.1, scale: 0.8, rotation: 5 };
    text.motion = link({ clipId: video.id, rotation: true, scale: true });
    const drawn = motionTransform(p, text, 0.7);
    const base = baseFromDrawn(p, text, 0.7, drawn);
    for (const k of ['x', 'y', 'scale', 'rotation'] as const) expect(base[k]).toBeCloseTo(text.transform[k]);
  });
});

describe('stabilize', () => {
  it('keeps the tracked point where it was at the reference time', () => {
    const { p, video } = setup([[0, 0.5, 0.5, 0, 1], [1, 0.6, 0.4, 30, 1.5]]);
    video.motion = link({ clipId: video.id, mode: 'stabilize', rotation: true, scale: true });
    for (const t of [0, 0.5, 1]) {
      const b = trackerBox(p, video, video.trackers![0], t)!;
      expect(b.cx).toBeCloseTo(960);
      expect(b.cy).toBeCloseTo(540);
      expect(b.rotation).toBeCloseTo(0);
      expect(b.w).toBeCloseTo(192);
    }
    const base = baseFromDrawn(p, video, 0.6, motionTransform(p, video, 0.6));
    for (const k of ['x', 'y', 'scale', 'rotation'] as const) expect(base[k]).toBeCloseTo(video.transform[k]);
  });

  it('position only: the picture shifts against the object', () => {
    const { p, video } = setup([[0, 0.5, 0.5, 0, 1], [1, 0.6, 0.5, 0, 1]]);
    video.motion = link({ clipId: video.id, mode: 'stabilize' });
    expect(motionTransform(p, video, 1).x).toBeCloseTo(-0.1);
  });
});

describe('tracker boxes and samples', () => {
  it('box on the canvas ↔ sample round trip', () => {
    const { p, video, tracker } = setup([[0, 0.25, 0.75, 0, 2]]);
    video.transform.scale = 0.5;
    const b = trackerBox(p, video, tracker, 0)!;
    expect(b.w).toBeCloseTo(0.1 * 1920 * 0.5 * 2);
    const moved = boxToSample(p, video, tracker, 0, 0, { ...b, cx: b.cx + 48, w: b.w * 2 })!;
    expect(moved.sample[1]).toBeCloseTo(0.25 + 96 / 1920);
    expect(moved.sample[2]).toBeCloseTo(0.75);
    expect(moved.width).toBeCloseTo(0.2);
    expect(moved.height).toBeCloseTo(0.1);
  });

  it('putSample inserts in order or replaces the same time', () => {
    const s: TrackSample[] = [[0, 0, 0, 0, 1], [1, 0, 0, 0, 1]];
    putSample(s, [0.5, 1, 1, 0, 1]);
    putSample(s, [1, 2, 2, 0, 1]);
    putSample(s, [3, 3, 3, 0, 1]);
    expect(s.map((x) => [x[0], x[1]])).toEqual([[0, 0], [0.5, 1], [1, 2], [3, 3]]);
  });

  it('mergeSamples replaces after (forward) or before (backward) the start', () => {
    const old: TrackSample[] = [0, 1, 2, 3].map((t) => [t, t, 0, 0, 1]);
    const fwd = mergeSamples(old, [[1, 9, 0, 0, 1], [1.5, 9, 0, 0, 1]], 1, 1);
    expect(fwd.map((x) => x[0])).toEqual([0, 1, 1.5]);
    const back = mergeSamples(old, [[0.5, 9, 0, 0, 1], [2, 9, 0, 0, 1]], 2, -1);
    expect(back.map((x) => x[0])).toEqual([0.5, 2, 3]);
  });
});

describe('normalizeMotion', () => {
  it('drops links whose tracker is gone, keeps valid ones', () => {
    const { p, video, text } = setup([[0, 0.5, 0.5, 0, 1]]);
    text.motion = link({ clipId: video.id });
    video.motion = link({ clipId: video.id, mode: 'stabilize' });
    normalizeMotion(p);
    expect(text.motion).toBeDefined();
    expect(video.motion).toBeDefined();
    video.trackers = [];
    normalizeMotion(p);
    expect(text.motion).toBeUndefined();
    expect(video.motion).toBeUndefined();
  });

  it('a split clip keeps the tracker on both parts and followers use the part on screen', () => {
    const { p, video, text } = setup([[0, 0.5, 0.5, 0, 1], [2, 0.7, 0.5, 0, 1]]);
    text.motion = link({ clipId: video.id });
    const right: Clip = { ...structuredClone(video), id: 'right', start: 1, inPoint: 1, duration: 2 };
    video.duration = 1;
    const track = createTrack('video');
    track.clips.push(right);
    p.tracks.push(track);
    expect(px(p, text, 1.5).x).toBeCloseTo(960 + 0.15 * 1920);
  });
});
