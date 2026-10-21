import { describe, expect, it } from 'vitest';
import { createProject } from '../../model/factories';
import { defaultShape } from '../../model/overlays';
import { addShapeClip, findClip } from '../../model/timeline';
import { applyBox, clipBox, contains, corners, moveLineEnd, resizeBox, rotateTowards, snapMove, toWorld, type Box } from './canvasGeometry';

const measure = {} as Parameters<typeof clipBox>[2]; // unused for shapes and media
const close = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

describe('canvas geometry', () => {
  it('gives a shape clip its box: centre from the transform, size × scale, rotation', () => {
    const p = createProject('t');
    const id = addShapeClip(p, 0, { ...defaultShape('rectangle'), width: 200, height: 100 });
    const clip = findClip(p, id)!.clip;
    clip.transform = { ...clip.transform, x: 0.25, y: -0.25, scale: 2, rotation: 90 };
    const b = clipBox(p, clip, measure)!;
    expect(b).toMatchObject({ cx: 1440, cy: 270, w: 400, h: 200 });
    close(b.rotation, Math.PI / 2);
  });

  it('gives a media clip the fitted, cropped picture rectangle', () => {
    const p = createProject('t');
    p.assets.a = { id: 'a', kind: 'image', name: 'a', width: 1000, height: 1000, fileRef: {} };
    const clip = { id: 'c', assetId: 'a', start: 0, duration: 1, inPoint: 0, speed: 1, audio: { volume: 1, fadeIn: 0, fadeOut: 0 }, transform: { x: 0, y: 0, scale: 0.5, rotation: 0, opacity: 1, crop: { x: 0, y: 0, width: 0.5, height: 1 } } };
    // Cropped 500×1000 contained in 1920×1080 → 540×1080, × 0.5.
    expect(clipBox(p, clip, measure)).toMatchObject({ cx: 960, cy: 540, w: 270, h: 540 });
  });

  it('hit-tests in the rotated frame', () => {
    const b: Box = { cx: 0, cy: 0, w: 100, h: 10, rotation: Math.PI / 2 };
    expect(contains(b, { x: 0, y: 40 })).toBe(true);
    expect(contains(b, { x: 40, y: 0 })).toBe(false);
    expect(corners(b).map((c) => [Math.round(c.x), Math.round(c.y)])).toEqual([[5, -50], [5, 50], [-5, 50], [-5, -50]]);
  });

  it('resizes from a corner keeping the opposite corner fixed (also when rotated)', () => {
    const b: Box = { cx: 100, cy: 100, w: 100, h: 50, rotation: Math.PI / 6 };
    const anchor = toWorld(b, { x: -50, y: -25 });
    const target = toWorld(b, { x: 150, y: 75 }); // bottom-right corner dragged out
    const r = resizeBox(b, 1, 1, target, false, false);
    close(r.w, 200);
    close(r.h, 100);
    const a2 = toWorld(r, { x: -r.w / 2, y: -r.h / 2 });
    close(a2.x, anchor.x);
    close(a2.y, anchor.y);
  });

  it('uniform resize projects the pointer on the diagonal; Alt resizes about the centre', () => {
    const b: Box = { cx: 0, cy: 0, w: 100, h: 50, rotation: 0 };
    const u = resizeBox(b, 1, 1, { x: 150, y: 25 }, true, false);
    expect(u.w / u.h).toBeCloseTo(2);
    const c = resizeBox(b, 1, 0, { x: 100, y: 0 }, false, true);
    expect(c).toMatchObject({ cx: 0, cy: 0, w: 200, h: 50 });
    // An edge only changes its own axis, never below the minimum.
    const e = resizeBox(b, 0, -1, { x: 0, y: 500 }, false, false);
    expect(e.w).toBe(100);
    expect(e.h).toBe(4);
  });

  it('rotates towards the pointer, in 15° steps with Shift', () => {
    const b: Box = { cx: 0, cy: 0, w: 10, h: 10, rotation: 0 };
    close(rotateTowards(b, { x: 10, y: 0 }, false), Math.PI / 2);
    close(rotateTowards(b, { x: 10, y: -1 }, true), Math.PI / 2);
  });

  it('moves one end of a line and keeps the other', () => {
    const b: Box = { cx: 0, cy: 0, w: 100, h: 10, rotation: 0 };
    const r = moveLineEnd(b, 1, { x: -50, y: 100 }, false);
    // Start stays at (-50, 0); the end is now straight below it.
    close(r.w, 100);
    close(r.rotation, Math.PI / 2);
    close(r.cx, -50);
    close(r.cy, 50);
    const s = moveLineEnd(b, -1, { x: 50, y: -60 }, false);
    close(s.w, 60);
    close(s.rotation, Math.PI / 2);
  });

  it('snaps the centre to the frame centre and unrotated edges to the frame edges', () => {
    const b: Box = { cx: 955, cy: 104, w: 200, h: 200, rotation: 0 };
    const s = snapMove(b, 1920, 1080, 6);
    expect(s).toMatchObject({ cx: 960, cy: 100, guides: { x: 960, y: 0 } });
    expect(snapMove({ ...b, rotation: 0.3 }, 1920, 1080, 6).guides).toEqual({ x: 960, y: undefined });
  });

  it('writes the box back: shapes as size, media and text as uniform scale', () => {
    const p = createProject('t');
    const id = addShapeClip(p, 0, defaultShape('square'));
    const clip = findClip(p, id)!.clip;
    const from = clipBox(p, clip, measure)!;
    applyBox(clip, from, { cx: 1440, cy: 540, w: 600, h: 400, rotation: -Math.PI / 4 }, 1920, 1080, 1);
    expect(clip.shape).toMatchObject({ width: 600, height: 600 }); // a square stays square
    expect(clip.transform).toMatchObject({ x: 0.25, y: 0, rotation: -45, scale: 1 });

    const media = { ...clip, shape: undefined, transform: { ...clip.transform, scale: 0.5 } };
    applyBox(media, { ...from, w: 100 }, { ...from, w: 300 }, 1920, 1080, 0.5);
    expect(media.transform.scale).toBeCloseTo(1.5);
  });
});
