import { describe, expect, it } from 'vitest';
import { motionTransform } from '../engine/render/motion';
import { aiAccess } from '../features/account/policy';
import { createProject, createTrack } from './factories';
import { cameraPath, type Detection } from './reframe';
import { createClip } from './timeline';
import type { Asset, Clip } from './types';

const at = (fps: number, seconds: number, fn: (s: number) => Detection) => Array.from({ length: fps * seconds }, (_, i) => fn(i / fps));

describe('cameraPath', () => {
  it('ignores jitter inside the dead zone', () => {
    const path = cameraPath(at(10, 4, (s) => ({ s, x: 0.5 + 0.03 * Math.sin(s * 20), y: 0.5 })));
    const xs = path.map((p) => p[1]);
    expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(0.02);
  });

  it('follows a jump at a limited speed and settles near the subject', () => {
    const path = cameraPath(at(10, 6, (s) => ({ s, x: s < 1 ? 0.2 : 0.8, y: 0.5 })));
    const x = (s: number) => path[Math.round(s * 10)][1];
    expect(x(0.5)).toBeCloseTo(0.2, 1);
    // Never faster than the limit (plus a little from the final easing).
    for (let i = 1; i < path.length; i++) expect(Math.abs(path[i][1] - path[i - 1][1])).toBeLessThan(0.06);
    expect(x(5.9)).toBeGreaterThan(0.72);
  });

  it('holds through missed frames and centres when nobody is found', () => {
    const gaps = cameraPath(at(10, 3, (s) => (s > 1 && s < 2 ? { s } : { s, x: 0.3, y: 0.4 })));
    expect(gaps.every((p) => Math.abs(p[1] - 0.3) < 1e-9 && Math.abs(p[2] - 0.4) < 1e-9)).toBe(true);
    expect(cameraPath(at(10, 1, (s) => ({ s })))[0].slice(1, 3)).toEqual([0.5, 0.5]);
  });
});

describe('reframe link', () => {
  // A 1920×1080 video in a 1080×1920 (9:16) project, filling the frame.
  const video: Asset = { id: 'v', kind: 'video', name: 'v.mp4', duration: 10, width: 1920, height: 1080, fileRef: {} };
  function setup(subjectX: number) {
    const p = createProject('t', '9:16');
    p.assets = { v: video };
    p.tracks = [createTrack('video')];
    const clip: Clip = {
      ...createClip(video, 0),
      id: 'c',
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, fit: 'cover' },
      trackers: [{ id: 'r', name: 'R', width: 0.2, height: 0.2, samples: [[0, subjectX, 0.5, 0, 1]] }],
      motion: { clipId: 'c', trackerId: 'r', mode: 'reframe', position: true, rotation: false, scale: false, ref: 0 },
    };
    p.tracks[0].clips = [clip];
    return { p, clip };
  }

  it('slides the picture so the subject is centred', () => {
    const { p, clip } = setup(0.6);
    // Cover: the picture is 3413 px wide; the subject at 60 % is 341 px right of centre.
    expect(motionTransform(p, clip, 1).x * 1080).toBeCloseTo(-(0.1 * 1920 * (1920 / 1080)), 0);
  });

  it('never slides past the picture’s edge', () => {
    const { p, clip } = setup(0.99);
    const room = (1920 * (1920 / 1080) - 1080) / 2;
    expect(motionTransform(p, clip, 1).x * 1080).toBeCloseTo(-room, 0);
  });
});

describe('aiAccess', () => {
  it('needs an account with an active Pro pass', () => {
    const now = 1_000_000;
    expect(aiAccess(null, now)).toBe('login');
    expect(aiAccess({ proUntil: null } as never, now)).toBe('upgrade');
    expect(aiAccess({ proUntil: now + 1 } as never, now)).toBe('ok');
  });
});
