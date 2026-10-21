import { describe, expect, it } from 'vitest';
import { remapAudio } from '../engine/export/audioMix';
import { createProject, createTrack } from './factories';
import { mediaTimeAt, sourceLength } from './remap';
import { flipToMedia, freezeFrame, normalizeCurve, setSpeedCurve, SPEED_PRESETS } from './speed';
import { createClip, findClip, splitClips } from './timeline';
import type { Asset, Clip } from './types';

const video: Asset = { id: 'v', kind: 'video', name: 'v.mp4', duration: 20, fileRef: {} };

function setup() {
  const p = createProject('t');
  p.assets = { v: video };
  p.tracks = [createTrack('video')];
  const a: Clip = { ...createClip(video, 1), id: 'a', inPoint: 2, duration: 4 };
  const b: Clip = { ...createClip(video, 8), id: 'b', inPoint: 10, duration: 2 };
  p.tracks[0].clips = [a, b];
  return p;
}
const clip = (p: ReturnType<typeof setup>, id: string) => findClip(p, id)!.clip;

describe('speed ramps', () => {
  it('keep the source range: the clip length follows the average speed', () => {
    const p = setup();
    setSpeedCurve(p, 'a', SPEED_PRESETS.flashIn, 'flashIn');
    const a = clip(p, 'a');
    expect(a.speedPreset).toBe('flashIn');
    expect(sourceLength(a)).toBeCloseTo(4, 9);
    expect(mediaTimeAt(a, a.start + a.duration)).toBeCloseTo(6, 9);
    // Back to constant speed: the average, same range.
    setSpeedCurve(p, 'a', null);
    expect(clip(p, 'a').speedCurve).toBeUndefined();
    expect(sourceLength(clip(p, 'a'))).toBeCloseTo(4, 1);
  });

  it('are cut short by the next clip and normalized', () => {
    const p = setup();
    setSpeedCurve(p, 'a', [[0, 0.2], [1, 0.2]]);
    expect(clip(p, 'a').duration).toBe(7); // 20 s at 0.2×, but b starts at 8
    expect(normalizeCurve([[0.5, 50], [0.2, 0.01]])).toEqual([[0, 0.1], [0.2, 0.1], [0.5, 10], [1, 10]]);
  });

  it('split keeps both halves on the same frames', () => {
    const p = setup();
    setSpeedCurve(p, 'a', SPEED_PRESETS.hero, 'hero');
    const before = { ...clip(p, 'a') };
    const cut = before.start + before.duration * 0.37;
    const [right] = splitClips(p, cut, new Set(['a']));
    for (const t of [before.start + 0.1, cut - 0.05]) expect(mediaTimeAt(clip(p, 'a'), t)).toBeCloseTo(mediaTimeAt(before, t), 9);
    for (const t of [cut + 0.05, before.start + before.duration - 0.1]) expect(mediaTimeAt(clip(p, right), t)).toBeCloseTo(mediaTimeAt(before, t), 9);
  });
});

describe('reverse (flip to a reversed copy)', () => {
  it('shows the mirrored frame at every time and flips stored source times', () => {
    const p = setup();
    p.assets.r = { id: 'r', kind: 'video', name: 'v (reversed).mov', duration: 20, fileRef: {}, reverseOf: { assetId: 'v', from: 0, to: 20 } };
    const a = clip(p, 'a');
    a.keyframes = [{ t: 2.5, v: { opacity: 0 } }, { t: 5, v: { opacity: 1 } }];
    a.trackers = [{ id: 'tr', name: 'T', width: 0.1, height: 0.1, samples: [[3, 0.5, 0.5, 0, 1], [4, 0.6, 0.5, 0, 1]] }];
    clip(p, 'b').motion = { clipId: 'a', trackerId: 'tr', mode: 'follow', position: true, rotation: false, scale: false, ref: 3 };
    const before = { ...a };
    flipToMedia(p, a, 'r', 20);
    expect(a.assetId).toBe('r');
    // At each moment the reversed copy shows what was at the mirrored source time: played backwards.
    for (const t of [1.2, 3, 4.9]) expect(20 - mediaTimeAt(a, t)).toBeCloseTo(mediaTimeAt(before, before.start + before.duration - (t - before.start)), 9);
    expect(a.keyframes.map((k) => k.t)).toEqual([15, 17.5]);
    expect(a.trackers[0].samples.map((s) => s[0])).toEqual([16, 17]);
    expect(clip(p, 'b').motion!.ref).toBe(17);
    // And back.
    flipToMedia(p, a, 'v', 20);
    expect(a.inPoint).toBeCloseTo(2, 9);
    expect(a.keyframes.map((k) => k.t)).toEqual([2.5, 5]);
  });
});

describe('freezeFrame', () => {
  it('splits, inserts a still of that frame and pushes the rest later', () => {
    const p = setup();
    clip(p, 'a').keyframes = [{ t: 2, v: { opacity: 0 } }, { t: 6, v: { opacity: 1 } }];
    const id = freezeFrame(p, 'a', 3, 2)!;
    const clips = p.tracks[0].clips;
    expect(clips.map((c) => [c.start, c.duration])).toEqual([
      [1, 2],
      [3, 2],
      [5, 2],
      [10, 2],
    ]);
    const still = clip(p, id);
    expect(still.freeze).toBe(true);
    expect(still.inPoint).toBe(4); // source 2 + 2 s into the clip
    expect(still.keyframes).toBeUndefined();
    expect(still.transform.opacity).toBeCloseTo(0.5, 6); // baked at that moment
    expect(mediaTimeAt(still, 4.5)).toBe(4);
  });
});

describe('remapAudio', () => {
  it('lays the source out on the timeline following a ramp', () => {
    const rate = 1000;
    // Source: a ramp signal (value = source time).
    const src = { channels: [Float32Array.from({ length: 10 * rate }, (_, i) => i / rate)], rate, start: 0 };
    const c: Clip = { ...createClip(video, 0), inPoint: 1, duration: 2, speedCurve: [[0, 1], [1, 3]] };
    const [l] = remapAudio(c, src, 0, 2, rate);
    for (const t of [0, 0.5, 1, 1.9]) expect(l[Math.round(t * rate)]).toBeCloseTo(mediaTimeAt(c, t), 2);
  });
});
