import { describe, expect, it } from 'vitest';
import { audioEnvelope } from '../engine/fade';
import { motionTransform } from '../engine/render/motion';
import { createEffect } from './effects';
import { createProject, createTrack } from './factories';
import {
  addKeyAt,
  clearKeys,
  easeAt,
  editAt,
  keyedClip,
  moveKey,
  peakVolume,
  propsAt,
  removeKey,
  setKeyEase,
  volumeAt,
} from './keyframes';
import { createClip, insertClip, splitClips } from './timeline';
import { parseProject } from './validate';
import type { Clip } from './types';

const TOL = 0.01;

function videoClip(start = 0): Clip {
  const c = createClip({ id: 'a', kind: 'video', name: '', duration: 30, hasAudio: true, fileRef: {} }, start);
  c.duration = 10;
  return c;
}

/** A clip moving x from 0 (at 0 s) to 0.4 (at 4 s), as the user would make it. */
function moving(ease?: 'linear') {
  const c = videoClip();
  addKeyAt(c, 0, TOL);
  editAt(c, 4, TOL, (x) => void (x.transform.x = 0.4));
  if (ease) setKeyEase(c, 0, ease);
  return c;
}

describe('eases', () => {
  it('runs from 0 to 1 with the expected shapes', () => {
    for (const e of ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const) {
      expect(easeAt(e, 0)).toBe(0);
      expect(easeAt(e, 1)).toBeCloseTo(1);
    }
    expect(easeAt('linear', 0.25)).toBe(0.25);
    expect(easeAt('easeIn', 0.5)).toBeCloseTo(0.125);
    expect(easeAt('easeOut', 0.5)).toBeCloseTo(0.875);
    expect(easeAt('easeInOut', 0.5)).toBeCloseTo(0.5);
    expect(easeAt('easeInOut', 0.25)).toBeCloseTo(0.0625);
    expect(easeAt('hold', 0.99)).toBe(0);
  });
});

describe('clip keyframes', () => {
  it('without keyframes edits apply as they are and nothing is resolved', () => {
    const c = videoClip();
    expect(keyedClip(c, 3)).toBe(c);
    editAt(c, 2, TOL, (x) => void (x.transform.scale = 2));
    expect(c.transform.scale).toBe(2);
    expect(c.keyframes).toBeUndefined();
  });

  it('◆ records the whole state; an edit elsewhere adds a keyframe there (InShot)', () => {
    const c = moving();
    expect(c.keyframes!.map((k) => k.t)).toEqual([0, 4]);
    expect(c.keyframes![0].v).toMatchObject({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, volume: 1 });
    expect(c.keyframes![1].v.x).toBe(0.4);
    // Ease in-out by default: halfway at the middle, slow near the keyframes.
    expect(keyedClip(c, 2).transform.x).toBeCloseTo(0.2);
    expect(keyedClip(c, 1).transform.x).toBeCloseTo(0.4 * 0.0625);
    // Held before the first and after the last.
    expect(keyedClip(c, 8).transform.x).toBeCloseTo(0.4);
    // The resolved clip is plain: no keyframes, the original untouched.
    expect(keyedClip(c, 2).keyframes).toBeUndefined();
    expect(c.keyframes).toHaveLength(2);
  });

  it('linear and hold eases', () => {
    const c = moving('linear');
    expect(keyedClip(c, 1).transform.x).toBeCloseTo(0.1);
    setKeyEase(c, 0, 'hold');
    expect(keyedClip(c, 3.9).transform.x).toBe(0);
    expect(keyedClip(c, 4).transform.x).toBeCloseTo(0.4);
    setKeyEase(c, 0, 'easeInOut');
    expect(c.keyframes![0]).not.toHaveProperty('ease');
  });

  it('edits at a keyframe update it; other keyframes keep their values', () => {
    const c = moving('linear');
    editAt(c, 4 + TOL / 2, TOL, (x) => void (x.transform.scale = 2));
    expect(c.keyframes).toHaveLength(2);
    expect(c.keyframes![1].v.scale).toBe(2);
    expect(c.keyframes![0].v.scale).toBe(1);
    expect(keyedClip(c, 2).transform.scale).toBeCloseTo(1.5);
  });

  it('a property no keyframe had is filled in on the others, so only the edited moment changes', () => {
    const c = moving('linear');
    for (const k of c.keyframes!) delete k.v.opacity;
    editAt(c, 4, TOL, (x) => void (x.transform.opacity = 0));
    expect(c.keyframes![0].v.opacity).toBe(1);
    expect(keyedClip(c, 2).transform.opacity).toBeCloseTo(0.5);
  });

  it('a new keyframe between two keeps the motion at that moment', () => {
    const c = moving('linear');
    editAt(c, 2, TOL, (x) => void (x.transform.rotation = 90));
    expect(c.keyframes!.map((k) => k.t)).toEqual([0, 2, 4]);
    expect(c.keyframes![1].v).toMatchObject({ x: expect.closeTo(0.2), rotation: 90 });
    expect(keyedClip(c, 3).transform.rotation).toBeCloseTo(45);
  });

  it('animates numeric effect settings; whole-number ones stay whole; removed effects leave the keyframes', () => {
    const c = videoClip();
    const blur = createEffect('gaussianBlur', { blurriness: 0 });
    const mosaic = createEffect('mosaic', { blockSize: 10 });
    c.effects = [blur, mosaic];
    addKeyAt(c, 0, TOL);
    editAt(c, 2, TOL, (x) => {
      x.effects![0].params.blurriness = 40;
      x.effects![1].params.blockSize = 21;
    });
    const mid = keyedClip(c, 1);
    expect(mid.effects![0].params.blurriness).toBeCloseTo(20);
    expect(Number.isInteger(mid.effects![1].params.blockSize)).toBe(true);
    expect(c.effects![0].params).not.toBe(mid.effects![0].params);
    editAt(c, 2, TOL, (x) => void (x.effects = x.effects!.filter((e) => e.id !== blur.id)));
    for (const k of c.keyframes!) expect(Object.keys(k.v).some((p) => p.includes(blur.id))).toBe(false);
  });

  it('removing the last keyframe or clearing keeps the clip as it looked', () => {
    const c = moving('linear');
    removeKey(c, 0);
    expect(c.keyframes).toHaveLength(1);
    removeKey(c, 0);
    expect(c.keyframes).toBeUndefined();
    expect(c.transform.x).toBe(0.4);
    const d = moving('linear');
    clearKeys(d, 1);
    expect(d.keyframes).toBeUndefined();
    expect(d.transform.x).toBeCloseTo(0.1);
  });

  it('moves a keyframe in time but never onto another', () => {
    const c = moving('linear');
    expect(moveKey(c, 1, 0, TOL)).toBe(1);
    expect(moveKey(c, 0, 6, TOL)).toBe(1);
    expect(c.keyframes!.map((k) => k.t)).toEqual([4, 6]);
    expect(propsAt(c, 5).x).toBeCloseTo(0.2);
  });

  it('keyframes are in source time: a split keeps the motion on both halves', () => {
    const p = createProject('p');
    const track = createTrack('video');
    p.tracks = [track];
    const c = moving('linear');
    insertClip(track, c);
    const [rightId] = splitClips(p, 3);
    const right = track.clips.find((x) => x.id === rightId)!;
    expect(keyedClip(c, 2).transform.x).toBeCloseTo(0.2);
    expect(keyedClip(right, 3.5).transform.x).toBeCloseTo(0.35);
  });

  it('a tracked clip with keyframes moves by its keyframes under the motion link', () => {
    const p = createProject('p');
    const c = moving('linear');
    expect(motionTransform(p, c, 2).x).toBeCloseTo(0.2);
  });

  it('survives saving and loading', () => {
    const p = createProject('p');
    const track = createTrack('video');
    p.tracks = [track];
    const c = moving('linear');
    c.keyframes!.reverse();
    insertClip(track, c);
    const back = parseProject(JSON.parse(JSON.stringify(p)));
    expect(back.tracks[0].clips[0].keyframes!.map((k) => k.t)).toEqual([0, 4]);
    c.keyframes![0].ease = 'bounce' as never;
    expect(() => parseProject(JSON.parse(JSON.stringify(p)))).toThrow();
  });
});

describe('volume keyframes', () => {
  it('shape the audio gain and become a ramp for the player', () => {
    const c = videoClip(10);
    c.inPoint = 0;
    addKeyAt(c, 1, TOL);
    editAt(c, 3, TOL, (x) => void (x.audio.volume = 0));
    setKeyEase(c, 0, 'linear');
    expect(volumeAt(c, 12)).toBeCloseTo(0.5);
    expect(volumeAt(c, 15)).toBe(0);
    expect(peakVolume(c)).toBe(1);
    const env = audioEnvelope(c);
    expect(env.gainAt(12)).toBeCloseTo(0.5);
    expect(env.ramps).toEqual([[11, 13]]);
  });

  it('merge with fades', () => {
    const c = videoClip(0);
    c.audio.fadeIn = 2;
    addKeyAt(c, 1, TOL);
    editAt(c, 4, TOL, (x) => void (x.audio.volume = 2));
    expect(audioEnvelope(c).ramps).toEqual([[0, 4]]);
    // Silent at the start but loud later: still played.
    editAt(c, 1, TOL, (x) => void (x.audio.volume = 0));
    expect(peakVolume(c)).toBe(2);
  });
});

describe('text keyframes', () => {
  it('size and colour animate between keyframes', async () => {
    const { createTextClip } = await import('./timeline');
    const { TEXT_STYLE_DEFAULTS } = await import('./overlays');
    const clip = createTextClip(0, { ...TEXT_STYLE_DEFAULTS, content: 'hi', rtl: false, color: '#000000', fontSize: 40 });
    addKeyAt(clip, 0, 0.01);
    editAt(clip, 2, 0.01, (c) => {
      c.text!.fontSize = 80;
      c.text!.color = '#ff8000';
    });
    const mid = keyedClip(clip, 1).text!;
    expect(mid.fontSize).toBeCloseTo(60);
    // Half way with the default ease in-out: each channel half way.
    expect(mid.color).toBe('#804000');
    expect(keyedClip(clip, 0).text!.fontSize).toBe(40);
  });
});
