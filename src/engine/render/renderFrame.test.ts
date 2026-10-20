import { describe, expect, it } from 'vitest';
import { createProject, createTrack } from '../../model/factories';
import { createClip, insertClip } from '../../model/timeline';
import type { Asset, Clip, Transform } from '../../model/types';
import { clipGainAt, fadeAlpha } from '../fade';
import { placeMedia, renderFrame, sourceTimeAt, type Ctx2D, type Drawable } from './renderFrame';

const tr = (over: Partial<Transform> = {}): Transform => ({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, ...over });

describe('placeMedia', () => {
  it('fits 16:9 media exactly into a 16:9 canvas', () => {
    const p = placeMedia(1280, 720, 1920, 1080, tr());
    expect(p.visible).toEqual({ x: -960, y: -540, w: 1920, h: 1080 });
    expect([p.cx, p.cy]).toEqual([960, 540]);
  });

  it('pillarboxes vertical video with contain, fills with cover', () => {
    expect(placeMedia(720, 1280, 1920, 1080, tr()).visible.w).toBeCloseTo(607.5);
    const cover = placeMedia(720, 1280, 1920, 1080, tr({ fit: 'cover' }));
    expect(cover.visible.w).toBeCloseTo(1920);
    expect(cover.visible.h).toBeCloseTo(3413.33, 1);
  });

  it('crops: the visible part is fitted and the full frame is offset behind it', () => {
    const p = placeMedia(1000, 1000, 1000, 1000, tr({ crop: { x: 0.5, y: 0, width: 0.5, height: 1 } }));
    expect(p.visible).toEqual({ x: -250, y: -500, w: 500, h: 1000 });
    expect(p.frame).toEqual({ x: -750, y: -500, w: 1000, h: 1000 });
  });

  it('applies scale, offset (fractions of the canvas) and rotation', () => {
    const p = placeMedia(1920, 1080, 1920, 1080, tr({ scale: 0.5, x: 0.25, y: -0.25, rotation: 90 }));
    expect(p.visible.w).toBe(960);
    expect([p.cx, p.cy]).toEqual([1440, 270]);
    expect(p.rotation).toBeCloseTo(Math.PI / 2);
  });
});

/** Records draw calls instead of painting. */
function recordingCtx() {
  const calls: string[] = [];
  const noop = () => {};
  const ctx = new Proxy(
    { calls, globalAlpha: 1 },
    {
      get: (target, key) => (key in target ? target[key as keyof typeof target] : noop),
      set: (target, key, value) => {
        (target as Record<string | symbol, unknown>)[key] = value;
        return true;
      },
    },
  );
  return ctx as unknown as Ctx2D & { calls: string[] };
}

const drawable = (name: string, calls: string[]): Drawable => ({
  displayWidth: 100,
  displayHeight: 100,
  draw: () => calls.push(name),
});

describe('renderFrame', () => {
  const asset: Asset = { id: 'a', kind: 'video', name: 'a', duration: 10, fileRef: {} };

  function project() {
    const p = createProject('t');
    const lower = p.tracks.find((t) => t.kind === 'video')!;
    const upper = createTrack('video');
    p.tracks.push(upper);
    insertClip(lower, { ...createClip(asset, 0), id: 'low' });
    insertClip(upper, { ...createClip(asset, 2), id: 'high', duration: 3 });
    insertClip(p.tracks.find((t) => t.kind === 'audio')!, { ...createClip(asset, 0), id: 'aud' });
    return p;
  }

  it('draws active visual clips bottom layer first and skips audio tracks', () => {
    const ctx = recordingCtx();
    renderFrame(project(), 3, ctx, (c: Clip) => drawable(c.id, ctx.calls));
    expect(ctx.calls).toEqual(['low', 'high']);
  });

  it('skips clips outside their range, without a frame, or fully transparent', () => {
    const p = project();
    const ctx = recordingCtx();
    renderFrame(p, 6, ctx, (c) => drawable(c.id, ctx.calls));
    expect(ctx.calls).toEqual(['low']);

    const ctx2 = recordingCtx();
    p.tracks.find((t) => t.clips.some((c) => c.id === 'low'))!.clips[0].transform.opacity = 0;
    renderFrame(p, 3, ctx2, (c) => (c.id === 'high' ? undefined : drawable(c.id, ctx2.calls)));
    expect(ctx2.calls).toEqual([]);
  });
});

describe('timing helpers', () => {
  it('maps timeline time to source time with in-point and speed', () => {
    const c = { ...createClip({ id: 'a', kind: 'video', name: '', duration: 10, fileRef: {} }, 4), inPoint: 1, speed: 2 };
    expect(sourceTimeAt(c, 5)).toBe(3);
  });

  it('fades and volume', () => {
    const c = { start: 10, duration: 4 };
    expect(fadeAlpha(c, 1, 2, 10.5)).toBe(0.5);
    expect(fadeAlpha(c, 1, 2, 12)).toBe(1);
    expect(fadeAlpha(c, 1, 2, 13.5)).toBe(0.25);
    const clip = { ...createClip({ id: 'a', kind: 'audio', name: '', duration: 10, fileRef: {} }, 0) };
    clip.audio = { volume: 0.8, fadeIn: 2, fadeOut: 0 };
    expect(clipGainAt(clip, 1)).toBeCloseTo(0.4);
  });
});
