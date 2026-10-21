import { describe, expect, it } from 'vitest';
import { placeMedia } from '../engine/render/placement';
import { createProject, createTrack } from './factories';
import { applyLayout, fitToCell, LAYOUTS, roundedRectPath } from './layouts';
import { createClip, findClip } from './timeline';
import type { Asset, Clip } from './types';

const layout = (id: string) => LAYOUTS.find((l) => l.id === id)!;
const wide: Asset = { id: 'w', kind: 'video', name: 'w.mp4', duration: 30, fileRef: {}, width: 1920, height: 1080, hasAudio: true };
const tall: Asset = { id: 't', kind: 'video', name: 't.mp4', duration: 30, fileRef: {}, width: 1080, height: 1920, hasAudio: true };
const music: Asset = { id: 'm', kind: 'audio', name: 'm.mp3', duration: 60, fileRef: {} };

/** The canvas rectangle a clip's visible picture covers. */
function covered(clip: Clip, asset: Asset, W: number, H: number) {
  const p = placeMedia(asset.width!, asset.height!, W, H, clip.transform);
  return { x: p.cx + p.visible.x, y: p.cy + p.visible.y, w: p.visible.w, h: p.visible.h };
}

describe('fitToCell', () => {
  for (const [W, H] of [
    [1920, 1080],
    [1080, 1920],
    [1080, 1080],
  ]) {
    it(`fills every cell exactly at ${W}×${H}`, () => {
      for (const l of LAYOUTS) {
        for (const cell of l.cells(W, H)) {
          for (const asset of [wide, tall]) {
            const clip = createClip(asset, 0);
            fitToCell(clip, cell, asset.width!, asset.height!, W, H);
            const r = covered(clip, asset, W, H);
            expect(r.x).toBeCloseTo(cell.x * W, 6);
            expect(r.y).toBeCloseTo(cell.y * H, 6);
            expect(r.w).toBeCloseTo(cell.w * W, 6);
            expect(r.h).toBeCloseTo(cell.h * H, 6);
          }
        }
      }
    });
  }

  it('crops to the middle of the source, and leaves an exact fit uncropped', () => {
    const clip = createClip(wide, 0);
    fitToCell(clip, { x: 0, y: 0, w: 0.5, h: 1 }, 1920, 1080, 1920, 1080); // a 960×1080 cell
    expect(clip.transform.crop!.width).toBeCloseTo(960 / 1080 / (16 / 9), 9);
    expect(clip.transform.crop!.x + clip.transform.crop!.width / 2).toBeCloseTo(0.5, 9);
    fitToCell(clip, { x: 0, y: 0, w: 1, h: 1 }, 1920, 1080, 1920, 1080);
    expect(clip.transform.crop).toBeUndefined();
    expect(clip.transform.scale).toBeCloseTo(1, 9);
  });

  it('gives circle and diagonal cells a mask over the visible part, and replaces its own effects', () => {
    const clip = createClip(wide, 0);
    clip.effects = [];
    const circle = layout('circle').cells(1920, 1080)[1];
    fitToCell(clip, circle, 1920, 1080, 1920, 1080);
    const xs = clip.masks![0].path.value.map((v) => v[0]);
    const crop = clip.transform.crop!;
    expect(Math.min(...xs)).toBeCloseTo(crop.x * 1920, 6);
    expect(Math.max(...xs)).toBeCloseTo((crop.x + crop.width) * 1920, 6);
    expect(clip.effects!.map((e) => e.kind)).toEqual(['stroke', 'dropShadow']);
    // Another layout: the old mask and effects go, a full-frame cell needs none.
    fitToCell(clip, layout('split2h').cells(1920, 1080)[0], 1920, 1080, 1920, 1080);
    expect(clip.masks).toBeUndefined();
    expect(clip.effects).toBeUndefined();
  });

  it('rounded corners stay inside the rectangle', () => {
    const path = roundedRectPath(10, 20, 100, 50, 8);
    for (const [x, y] of path) {
      expect(x).toBeGreaterThanOrEqual(10);
      expect(x).toBeLessThanOrEqual(110);
      expect(y).toBeGreaterThanOrEqual(20);
      expect(y).toBeLessThanOrEqual(70);
    }
  });
});

describe('applyLayout', () => {
  function setup() {
    const p = createProject('t');
    p.assets = { w: wide, t: tall, m: music };
    p.tracks = [createTrack('audio'), createTrack('video'), createTrack('video')];
    p.tracks[0].clips = [{ ...createClip(music, 0), id: 'music' }];
    p.tracks[1].clips = [
      { ...createClip(wide, 2), id: 'a', duration: 4 },
      { ...createClip(tall, 6), id: 'b', duration: 3 },
    ];
    p.tracks[2].clips = [{ ...createClip(wide, 1), id: 'title', duration: 2, assetId: undefined, text: undefined }];
    return p;
  }

  it('stacks the clips over the same time on new tracks, bottom cell first', () => {
    const p = setup();
    const ids = applyLayout(p, layout('split2h'), ['b', 'a', 'music']);
    expect(ids).toEqual(['a', 'b']); // music is not visual; timeline order decides the cells
    // The emptied video track is gone; the new ones sit above where the clips were.
    expect(p.tracks.map((t) => t.clips.map((c) => c.id))).toEqual([['music'], ['a'], ['b'], ['title']]);
    expect(p.tracks[1].clips[0].start).toBe(2);
    expect(p.tracks[2].clips[0].start).toBe(2);
    expect(p.tracks[1].clips[0].transform.x).toBeLessThan(0);
    expect(p.tracks[2].clips[0].transform.x).toBeGreaterThan(0);
    // Another layout over the same clips doesn't pile up tracks.
    applyLayout(p, layout('split2v'), ids);
    expect(p.tracks).toHaveLength(4);
  });

  it('uses only as many clips as the layout has cells', () => {
    const p = setup();
    p.tracks[1].clips.push({ ...createClip(wide, 10), id: 'c', duration: 2 });
    expect(applyLayout(p, layout('pipTopLeft'), ['a', 'b', 'c'])).toEqual(['a', 'b']);
    expect(p.tracks[1].clips.map((c) => c.id)).toEqual(['c']); // the third stays where it was
    expect(applyLayout(setup(), layout('split4'), ['a'])).toEqual(['a']);
    // One clip and a picture-in-picture: it becomes the small picture, not the background.
    const q = setup();
    applyLayout(q, layout('pipTopRight'), ['a']);
    expect(findClip(q, 'a')!.clip.transform.scale).toBeLessThan(0.5);
    const r = setup();
    applyLayout(r, layout('split2h'), ['a']);
    expect(findClip(r, 'a')!.clip.transform.x).toBeLessThan(0); // splits fill from the first cell
    expect(applyLayout(setup(), layout('split4'), ['music'])).toEqual([]);
  });
});
