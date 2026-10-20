import { describe, expect, it } from 'vitest';
import { createProject, createTrack } from '../../model/factories';
import { createClip, insertClip } from '../../model/timeline';
import { setTransition } from '../../model/transitions';
import { audioEnvelope } from '../fade';
import { scheduleEnvelope } from './audioEngine';

function recorder() {
  const calls: (['set', number, number] | ['curve', number[], number, number])[] = [];
  const param = {
    setValueAtTime: (v: number, t: number) => calls.push(['set', +v.toFixed(3), t]),
    setValueCurveAtTime: (c: Float32Array, t: number, d: number) =>
      calls.push(['curve', [c[0], c[c.length - 1]].map((x) => +x.toFixed(3)), t, +d.toFixed(3)]),
  } as unknown as AudioParam;
  return { calls, param };
}

const clip = (fadeIn: number, fadeOut: number) => {
  const c = createClip({ id: 'a', kind: 'audio', name: '', duration: 30, fileRef: {} }, 10);
  c.duration = 10;
  c.audio = { volume: 0.5, fadeIn, fadeOut };
  return c;
};
const toCtx = (t: number) => t + 100;

describe('audioEnvelope (no transitions)', () => {
  it('is the volume with linear fades and silent outside the clip', () => {
    const env = audioEnvelope(clip(2, 4));
    expect(env.gainAt(9)).toBe(0);
    expect(env.gainAt(11)).toBeCloseTo(0.25);
    expect(env.gainAt(15)).toBe(0.5);
    expect(env.gainAt(18)).toBeCloseTo(0.25);
    expect(env.ramps).toEqual([
      [10, 12],
      [16, 20],
    ]);
  });
});

describe('scheduleEnvelope', () => {
  it('plain volume is one value', () => {
    const { calls, param } = recorder();
    scheduleEnvelope(param, audioEnvelope(clip(0, 0)), 10, 20, toCtx);
    expect(calls).toEqual([['set', 0.5, 110]]);
  });

  it('fades become curves; no event sits on a curve start', () => {
    const { calls, param } = recorder();
    scheduleEnvelope(param, audioEnvelope(clip(2, 4)), 10, 20, toCtx);
    expect(calls).toEqual([
      ['curve', [0, 0.5], 110, 2],
      ['curve', [0.5, 0], 116, 4],
    ]);
  });

  it('starting mid-fade starts mid-curve', () => {
    const { calls, param } = recorder();
    scheduleEnvelope(param, audioEnvelope(clip(2, 0)), 11, 20, toCtx);
    expect(calls).toEqual([['curve', [0.25, 0.5], 111, 1]]);
  });
});

describe('audio crossfade at a transition', () => {
  it('equal-power: out = cos, in = sin, constant power across the window', () => {
    const p = createProject('t');
    const asset = { id: 'v', kind: 'audio' as const, name: '', duration: 60, fileRef: {} };
    const track = createTrack('audio');
    p.tracks = [track];
    insertClip(track, { ...createClip(asset, 0), id: 'a', duration: 4 });
    // b starts 2 s into its media, so there is audio before its in-point for the crossfade.
    insertClip(track, { ...createClip(asset, 4), id: 'b', duration: 4, inPoint: 2 });
    setTransition(p, 'a', 'b', 'crossfade', 2);
    const media = () => 60;
    const a = audioEnvelope(track.clips[0], track, media);
    const b = audioEnvelope(track.clips[1], track, media);
    expect([a.start, a.end, b.start, b.end]).toEqual([0, 5, 3, 8]);
    for (const t of [3, 3.5, 4, 4.5, 5]) expect(a.gainAt(t) ** 2 + b.gainAt(t) ** 2).toBeCloseTo(1);
    expect(a.gainAt(4)).toBeCloseTo(Math.SQRT1_2);
    expect(a.ramps).toEqual([[3, 5]]);
    expect(b.ramps).toEqual([[3, 5]]);
  });

  it('without handles the audio window shrinks to a clean cut (no level dip)', () => {
    const p = createProject('t');
    const asset = { id: 'v', kind: 'audio' as const, name: '', duration: 4, fileRef: {} };
    const track = createTrack('audio');
    p.tracks = [track];
    insertClip(track, { ...createClip(asset, 0), id: 'a', duration: 4 }); // uses all 4 s of its media
    insertClip(track, { ...createClip(asset, 4), id: 'b', duration: 4 }); // starts at its media start
    setTransition(p, 'a', 'b', 'crossfade', 2);
    const media = () => 4;
    const a = audioEnvelope(track.clips[0], track, media);
    const b = audioEnvelope(track.clips[1], track, media);
    expect([a.end, b.start]).toEqual([4, 4]);
    expect(a.gainAt(3.99)).toBe(1);
    expect(b.gainAt(4.01)).toBe(1);
  });
});
