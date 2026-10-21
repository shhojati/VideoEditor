import { describe, expect, it } from 'vitest';
import { createProject } from '../../model/factories';
import { createMask, rectPath } from '../../model/masks';
import { addAdjustmentClipAbove, createClip, findClip, insertClip } from '../../model/timeline';
import type { Asset, Project, TrackSample } from '../../model/types';
import { clipBox } from '../../features/preview/canvasGeometry';
import { applyAffine, composeAffine, invertAffine, layerAffine, maskCarry, maskShapeAt, resolveMasks, type Affine } from './masks';

const asset: Asset = { id: 'a', kind: 'video', name: 'v.mp4', duration: 10, width: 960, height: 540, fileRef: {} };

/** A 1920×1080 project with a 960×540 video full-frame (1 source px = 2 canvas px). */
function setup(samples: TrackSample[] = []) {
  const p: Project = createProject('t');
  p.assets.a = asset;
  const video = createClip(asset, 0);
  if (samples.length) video.trackers = [{ id: 'tr', name: 'Object', width: 0.1, height: 0.1, samples }];
  insertClip(p.tracks.find((t) => t.kind === 'video')!, video);
  return { p, video };
}

const at = (m: Affine, x: number, y: number) => applyAffine(m, { x, y });

describe('mask layer space', () => {
  it('maps source pixels of a video through its placement', () => {
    const { p, video } = setup();
    expect(at(layerAffine(p, video)!, 0, 0)).toEqual({ x: 0, y: 0 });
    expect(at(layerAffine(p, video)!, 960, 540)).toEqual({ x: 1920, y: 1080 });
    const moved = layerAffine(p, video, { ...video.transform, scale: 0.5, rotation: 90 })!;
    const c = at(moved, 480, 270);
    expect(c.x).toBeCloseTo(960);
    expect(c.y).toBeCloseTo(540);
    const corner = at(moved, 0, 0);
    expect(corner.x).toBeCloseTo(960 + 270);
    expect(corner.y).toBeCloseTo(540 - 480);
  });

  it('maps an overlay’s units around its position, and inverts', () => {
    const p = createProject('t');
    const id = addAdjustmentClipAbove(p, 0, 0, 2, { effects: [], transform: { x: 0.25, y: 0, scale: 2, rotation: 0, opacity: 1 } });
    const m = layerAffine(p, findClip(p, id)!.clip)!;
    expect(at(m, 10, 5)).toEqual({ x: 1440 + 20, y: 540 + 10 });
    const back = at(composeAffine(invertAffine(m), m), 3, 4);
    expect(back.x).toBeCloseTo(3);
    expect(back.y).toBeCloseTo(4);
  });
});

describe('masks carried by a tracker', () => {
  // The object moves right 100 px (source), turns 90° and doubles in size between 0 s and 1 s.
  const samples: TrackSample[] = [
    [0, 0.5, 0.5, 0, 1],
    [1, 0.5 + 100 / 960, 0.5, 90, 2],
  ];

  it('is the identity at the reference time and follows position, rotation and scale', () => {
    const { p, video } = setup(samples);
    const m = createMask('M', rectPath(480, 270, 40, 20));
    m.track = { trackerId: 'tr', position: true, rotation: true, scale: true, ref: 0 };
    const id0 = maskCarry(p, video, m, 0)!;
    expect(at(id0, 7, 9)).toEqual({ x: 7, y: 9 });
    const g = maskCarry(p, video, m, 1)!;
    // A point 10 px right of the object ends up 20 px below its new centre.
    const q = at(g, 490, 270);
    expect(q.x).toBeCloseTo(580);
    expect(q.y).toBeCloseTo(290);
    m.feather = { value: 5 };
    expect(maskShapeAt(p, video, m, 1).feather).toBeCloseTo(10);
  });

  it('follows only the parts that are on', () => {
    const { p, video } = setup(samples);
    const m = createMask('M', rectPath(480, 270, 40, 20));
    m.track = { trackerId: 'tr', position: true, rotation: false, scale: false, ref: 0 };
    const q = at(maskCarry(p, video, m, 1)!, 490, 270);
    expect(q.x).toBeCloseTo(590);
    expect(q.y).toBeCloseTo(270);
  });

  it('uses a tracker on another clip of the same media (a copy above)', () => {
    const { p } = setup(samples);
    const copy = createClip(asset, 0);
    p.tracks.unshift({ id: 'v2', kind: 'video', muted: false, locked: false, clips: [copy] });
    const m = createMask('M', rectPath(480, 270, 40, 20));
    m.track = { trackerId: 'tr', position: true, rotation: false, scale: false, ref: 0 };
    expect(maskCarry(p, copy, m, 1)).toBeDefined();
  });
});

describe('resolveMasks', () => {
  it('skips switched-off and invisible masks and evaluates keys at the clip’s source time', () => {
    const { p, video } = setup();
    video.inPoint = 2;
    video.start = 1;
    const off = createMask('off', rectPath(0, 0, 10, 10));
    off.off = true;
    const hidden = createMask('hidden', rectPath(0, 0, 10, 10));
    hidden.opacity = { value: 0 };
    const live = createMask('live', rectPath(0, 0, 10, 10));
    live.expansion = { value: 0, keys: [{ t: 2, v: 0 }, { t: 4, v: 20 }] };
    video.masks = [off, hidden, live];
    const r = resolveMasks(p, video, 2)!; // source time 3
    expect(r.shapes).toHaveLength(1);
    expect(r.shapes[0].expansion).toBe(10);
    video.masks = [off];
    expect(resolveMasks(p, video, 2)).toBeUndefined();
  });

  it('gives an adjustment layer a canvas box from its masks', () => {
    const p = createProject('t');
    const id = addAdjustmentClipAbove(p, 0, 0, 2, { effects: [], masks: [createMask('M', rectPath(50, 0, 100, 40))], transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 } });
    const clip = findClip(p, id)!.clip;
    expect(clipBox(p, clip, {} as Parameters<typeof clipBox>[2], 0)).toMatchObject({ cx: 960, cy: 540, w: 200, h: 40 });
    clip.masks = undefined;
    expect(clipBox(p, clip, {} as Parameters<typeof clipBox>[2], 0)).toBeNull();
  });
});
