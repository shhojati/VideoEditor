import { describe, expect, it } from 'vitest';
import { createProject, createTrack } from '../../model/factories';
import { createClip } from '../../model/timeline';
import type { Asset, Clip } from '../../model/types';
import { audioEnvelope } from '../fade';
import { activityFromPeaks, duckGainAt, duckPlan, mergeIntervals, type Interval } from './ducking';

/** Min/max peak pairs at 10 per second from a per-step amplitude list. */
const peaksOf = (amps: number[]) => Float32Array.from(amps.flatMap((a) => [-a, a]));

describe('activityFromPeaks', () => {
  it('finds loud runs, bridges short pauses and drops blips', () => {
    // 1 s silence, 1 s speech, 0.2 s pause, 1 s speech, 1 s silence, a 0.1 s blip.
    const amps = [...Array(10).fill(0.005), ...Array(10).fill(0.5), 0.01, 0.01, ...Array(10).fill(0.4), ...Array(10).fill(0.005), 0.6, ...Array(5).fill(0.005)];
    const runs = activityFromPeaks(peaksOf(amps), 10);
    expect(runs).toHaveLength(1);
    expect(runs[0][0]).toBeCloseTo(1);
    expect(runs[0][1]).toBeCloseTo(3.2);
  });

  it('adapts the threshold to a quiet recording', () => {
    const amps = [...Array(10).fill(0.001), ...Array(10).fill(0.06), ...Array(10).fill(0.001)];
    expect(activityFromPeaks(peaksOf(amps), 10)).toEqual([[1, 2]]);
  });
});

describe('duckGainAt', () => {
  const duck = { amount: -20, attack: 0.5, release: 1 };
  const speech: Interval[] = [[2, 4]];
  it('is down during speech, ramps before it and recovers after', () => {
    expect(duckGainAt(speech, duck, 1)).toBe(1);
    expect(duckGainAt(speech, duck, 1.75)).toBeCloseTo(1 - 0.9 * 0.5);
    expect(duckGainAt(speech, duck, 3)).toBeCloseTo(0.1);
    expect(duckGainAt(speech, duck, 4.5)).toBeCloseTo(1 - 0.9 * 0.5);
    expect(duckGainAt(speech, duck, 5.5)).toBe(1);
  });
});

describe('duckPlan', () => {
  const voice: Asset = { id: 'voice', kind: 'audio', name: 'v.webm', duration: 20, fileRef: {} };
  const music: Asset = { id: 'music', kind: 'audio', name: 'm.mp3', duration: 60, fileRef: {} };

  function setup() {
    const p = createProject('t');
    p.assets = { voice, music };
    p.tracks = [createTrack('audio'), createTrack('audio')];
    const v = { ...createClip(voice, 5), id: 'v', inPoint: 2, duration: 10 };
    const m: Clip = { ...createClip(music, 0), id: 'm', duration: 30, audio: { volume: 1, fadeIn: 0, fadeOut: 0, duck: { amount: -12, attack: 0.3, release: 0.6 } } };
    p.tracks[0].clips = [m];
    p.tracks[1].clips = [v];
    return { p, v, m };
  }

  it('maps the voice clip activity to the timeline and merges close gaps', () => {
    const { p } = setup();
    // Source speech at 3–4 s, 4.5–5 s (gap 0.5 < attack + release) and 30 s (outside the clip).
    const plan = duckPlan(p, (id) => (id === 'voice' ? [[3, 4], [4.5, 5], [30, 31]] : undefined));
    expect(plan).toEqual({ m: [[6, 8]] });
  });

  it('ignores muted tracks, silent clips and the ducked clip itself', () => {
    const { p, v } = setup();
    v.audio.volume = 0;
    expect(duckPlan(p, () => [[0, 100]])).toEqual({});
    v.audio.volume = 1;
    p.tracks[1].muted = true;
    expect(duckPlan(p, () => [[0, 100]])).toEqual({});
  });

  it('is applied by the audio envelope, with gain ramps around it', () => {
    const { p, m } = setup();
    const plan = duckPlan(p, (id) => (id === 'voice' ? [[3, 4]] : undefined));
    const env = audioEnvelope(m, p.tracks[0], undefined, plan.m);
    expect(env.gainAt(1)).toBe(1);
    expect(env.gainAt(7)).toBeCloseTo(10 ** (-12 / 20));
    expect(env.ramps).toEqual([[5.7, 6], [7, 7.6]].map(([a, b]) => [expect.closeTo(a), expect.closeTo(b)]));
    // Without the setting, a plan entry does nothing.
    delete m.audio.duck;
    expect(audioEnvelope(m, p.tracks[0], undefined, plan.m).gainAt(7)).toBe(1);
  });
});

describe('mergeIntervals', () => {
  it('sorts and joins within the gap', () => {
    expect(mergeIntervals([[5, 6], [0, 1], [1.2, 2]], 0.3)).toEqual([[0, 2], [5, 6]]);
  });
});
