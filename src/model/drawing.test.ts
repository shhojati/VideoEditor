// Drawing D1 model pieces: arranging clips, groups that pivot about their content, and breaking a
// turned / scaled group apart without anything moving.
import { describe, expect, it } from 'vitest';
import { createProject, createTrack } from './factories';
import { defaultShape, shadowOffset } from './overlays';
import { breakApart, makeCompound } from './sequences';
import { arrangeClip, createOverlayClip, findClip } from './timeline';
import type { Clip, Project } from './types';

function shape(id: string, start: number, duration: number, x = 0, y = 0): Clip {
  const c = createOverlayClip(start, { shape: { ...defaultShape('square'), width: 100, height: 100 } });
  return { ...c, id, duration, transform: { ...c.transform, x, y } };
}

/** Tracks bottom → top: A (0–4), B (2–6), C (0–10), all graphics. */
function stack(): Project {
  const p = createProject('t');
  p.tracks = [createTrack('audio'), createTrack('text'), createTrack('text'), createTrack('text')];
  p.tracks[1].clips = [shape('A', 0, 4)];
  p.tracks[2].clips = [shape('B', 2, 4)];
  p.tracks[3].clips = [shape('C', 0, 10)];
  return p;
}

const order = (p: Project) => p.tracks.filter((t) => t.kind !== 'audio').map((t) => t.clips.map((c) => c.id).join(','));

describe('arrangeClip', () => {
  it('brings a clip to the front on a new track above everything it overlaps', () => {
    const p = stack();
    expect(arrangeClip(p, 'A', 'bringToFront')).toBe(true);
    // A's old track was left empty and removed.
    expect(order(p)).toEqual(['B', 'C', 'A']);
  });

  it('moves one step past the next overlapping clip, using a free track in between', () => {
    const p = stack();
    p.tracks.splice(3, 0, createTrack('text'));
    expect(order(p)).toEqual(['A', 'B', '', 'C']);
    arrangeClip(p, 'A', 'forward');
    expect(order(p)).toEqual(['B', 'A', 'C']);
    arrangeClip(p, 'C', 'backward');
    expect(order(p)).toEqual(['B', 'C', 'A']);
  });

  it('sends to the back above the sound tracks, and refuses when nothing is in the way', () => {
    const p = stack();
    arrangeClip(p, 'C', 'sendToBack');
    expect(p.tracks[0].kind).toBe('audio');
    expect(order(p)).toEqual(['C', 'A', 'B']);
    expect(arrangeClip(p, 'C', 'backward')).toBe(false);
  });

  it('only counts clips that overlap it in time', () => {
    const p = stack();
    p.tracks[3].clips = [shape('C', 6, 4)];
    // A (0–4) is under B but not under C (6–10): it can share C's track, which is free then.
    arrangeClip(p, 'A', 'bringToFront');
    expect(order(p)).toEqual(['B', 'A,C']);
  });
});

describe('groups', () => {
  const W = 1920;
  const H = 1080;
  /** Where a clip's centre is drawn (px), through its compound when inside one. */
  function drawnCentre(outer: Clip | undefined, c: Clip) {
    let x = W / 2 + c.transform.x * W;
    let y = H / 2 + c.transform.y * H;
    if (!outer) return [x, y];
    const t = outer.transform;
    const a = (t.rotation * Math.PI) / 180;
    const lx = (x - W / 2) * t.scale;
    const ly = (y - H / 2) * t.scale;
    x = W / 2 + t.x * W + lx * Math.cos(a) - ly * Math.sin(a);
    y = H / 2 + t.y * H + lx * Math.sin(a) + ly * Math.cos(a);
    return [x, y];
  }

  function face() {
    const p = createProject('t');
    p.settings = { ...p.settings, width: W, height: H };
    p.tracks = [createTrack('text'), createTrack('text')];
    p.tracks[0].clips = [shape('head', 0, 5, 0.25, 0.1)];
    p.tracks[1].clips = [{ ...shape('eye', 0, 5, 0.27, 0.08), keyframes: [{ t: 1, v: { x: 0.3, opacity: 0.5 } }] }];
    return p;
  }

  it('pivots a group about the middle of its content without moving anything', () => {
    const p = face();
    const pivot = { x: W / 2 + 0.26 * W, y: H / 2 + 0.09 * H };
    const id = makeCompound(p, ['head', 'eye'], 'Head', { pivot })!;
    const g = findClip(p, id)!.clip;
    // In the stack where the parts were; the tracks they left are gone (one graphics track stays).
    expect(p.tracks.map((t) => t.kind)).toEqual(['video', 'text']);
    expect(g.transform.x).toBeCloseTo(0.26);
    expect(g.transform.y).toBeCloseTo(0.09);
    const inner = p.sequences![g.sequenceId!].tracks.flatMap((t) => t.clips);
    const head = inner.find((c) => c.id === 'head')!;
    const eye = inner.find((c) => c.id === 'eye')!;
    expect(drawnCentre(g, head)[0]).toBeCloseTo(W / 2 + 0.25 * W);
    expect(drawnCentre(g, eye)[1]).toBeCloseTo(H / 2 + 0.08 * H);
    // Keyframed positions move with it.
    expect(eye.keyframes![0].v.x).toBeCloseTo(0.04);
  });

  it('breaks a turned, scaled, faded group apart where its clips were drawn', () => {
    const p = face();
    const id = makeCompound(p, ['head', 'eye'], 'Head', { pivot: { x: W / 2 + 0.26 * W, y: H / 2 + 0.09 * H } })!;
    const g = findClip(p, id)!.clip;
    Object.assign(g.transform, { rotation: 30, scale: 2, opacity: 0.5 });
    const inner = p.sequences![g.sequenceId!].tracks.flatMap((t) => t.clips);
    const before = Object.fromEntries(inner.map((c) => [c.id, drawnCentre(g, c)]));
    expect(breakApart(p, id)).toBe(true);
    for (const cid of ['head', 'eye']) {
      const c = findClip(p, cid)!.clip;
      const [x, y] = drawnCentre(undefined, c);
      expect(x).toBeCloseTo(before[cid][0], 6);
      expect(y).toBeCloseTo(before[cid][1], 6);
      expect(c.transform).toMatchObject({ rotation: 30, scale: 2, opacity: 0.5 });
    }
    expect(findClip(p, 'eye')!.clip.keyframes![0].v.opacity).toBeCloseTo(0.25);
  });

  it('says when a group had settings its clips cannot take', () => {
    const p = face();
    const id = makeCompound(p, ['head', 'eye'], 'Head')!;
    findClip(p, id)!.clip.blend = 'multiply';
    expect(breakApart(p, id)).toBe('approx');
  });
});

describe('shadowOffset', () => {
  it('keeps the old look until an offset is set', () => {
    const s = { ...defaultShape('square'), width: 200, height: 100 };
    expect(shadowOffset(s)).toEqual({ shadowX: 0, shadowY: 4 });
    expect(shadowOffset({ ...s, shadowX: -3 })).toEqual({ shadowX: -3, shadowY: 0 });
  });
});
