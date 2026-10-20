import { describe, expect, it } from 'vitest';
import { createProject, createTrack } from '../../model/factories';
import { createClip, insertClip } from '../../model/timeline';
import { setTransition } from '../../model/transitions';
import type { Asset } from '../../model/types';
import { drawPlanAt, visualClipsAt, type Ctx2D } from './renderFrame';
import { drawTransition } from './transitions';

/** Minimal 2D context that tracks alpha, translation, scale and clip rect, and logs draws. */
function fakeCtx() {
  type S = { alpha: number; tx: number; ty: number; s: number; clip?: number[]; filter: string };
  let st: S = { alpha: 1, tx: 0, ty: 0, s: 1, filter: 'none' };
  const stack: S[] = [];
  let path: number[] | undefined;
  const log: { what: string; alpha: number; tx: number; s: number; clip?: number[]; filter: string; fill?: string }[] = [];
  const ctx = {
    get globalAlpha() { return st.alpha; },
    set globalAlpha(v: number) { st.alpha = v; },
    get filter() { return st.filter; },
    set filter(v: string) { st.filter = v; },
    fillStyle: '',
    save: () => stack.push({ ...st }),
    restore: () => void (st = stack.pop()!),
    translate: (x: number, y: number) => {
      st.tx += x * st.s;
      st.ty += y * st.s;
    },
    scale: (k: number) => void (st.s *= k),
    beginPath: () => void (path = undefined),
    rect: (...r: number[]) => void (path = r),
    clip: () => void (st.clip = path),
    fillRect: () => log.push({ what: 'fill', alpha: st.alpha, tx: st.tx, s: st.s, clip: st.clip, filter: st.filter, fill: ctx.fillStyle }),
  };
  const draw = (what: string) => () => log.push({ what, alpha: st.alpha, tx: st.tx, s: st.s, clip: st.clip, filter: st.filter });
  return { ctx: ctx as unknown as Ctx2D, log, draw };
}

const W = 100;
const H = 50;

describe('drawTransition', () => {
  it('crossfade draws the incoming clip over the outgoing one at alpha p', () => {
    const f = fakeCtx();
    drawTransition(f.ctx, 'crossfade', 0.25, W, H, f.draw('from'), f.draw('to'));
    expect(f.log.map((l) => [l.what, l.alpha])).toEqual([['from', 1], ['to', 0.25]]);
  });

  it('dip to black covers the outgoing clip, then uncovers the incoming one', () => {
    const a = fakeCtx();
    drawTransition(a.ctx, 'dipBlack', 0.25, W, H, a.draw('from'), a.draw('to'));
    expect(a.log.map((l) => [l.what, l.alpha, l.fill])).toEqual([['from', 1, undefined], ['fill', 0.5, '#000']]);
    const b = fakeCtx();
    drawTransition(b.ctx, 'dipWhite', 0.75, W, H, b.draw('from'), b.draw('to'));
    expect(b.log.map((l) => [l.what, l.alpha, l.fill])).toEqual([['to', 1, undefined], ['fill', 0.5, '#fff']]);
  });

  it('wipe reveals the incoming clip in the named direction', () => {
    const f = fakeCtx();
    drawTransition(f.ctx, 'wipeLeft', 0.5, W, H, f.draw('from'), f.draw('to'));
    expect(f.log[1]).toMatchObject({ what: 'to', clip: [50, 0, 50, 50] });
    const g = fakeCtx();
    drawTransition(g.ctx, 'wipeDown', 0.5, W, H, g.draw('from'), g.draw('to'));
    expect(g.log[1].clip).toEqual([0, 0, 100, 25]);
  });

  it('push moves both clips; slide moves only the incoming one', () => {
    const f = fakeCtx();
    drawTransition(f.ctx, 'pushLeft', 0.5, W, H, f.draw('from'), f.draw('to'));
    expect(f.log.map((l) => [l.what, l.tx])).toEqual([['from', -50], ['to', 50]]);
    const g = fakeCtx();
    drawTransition(g.ctx, 'slideRight', 0.5, W, H, g.draw('from'), g.draw('to'));
    expect(g.log.map((l) => [l.what, l.tx])).toEqual([['from', 0], ['to', -50]]);
  });

  it('zoom scales about the centre and blur peaks in the middle', () => {
    const f = fakeCtx();
    drawTransition(f.ctx, 'zoomIn', 1, W, H, f.draw('from'), f.draw('to'));
    expect(f.log[0].s).toBeCloseTo(1.6);
    const g = fakeCtx();
    drawTransition(g.ctx, 'blur', 0.5, W, H, g.draw('from'), g.draw('to'));
    expect(g.log[0].filter).toBe('blur(1.5px)'); // 3% of the short side
    const h = fakeCtx();
    drawTransition(h.ctx, 'blur', 0, W, H, h.draw('from'), h.draw('to'));
    expect(h.log[0].filter).toBe('none');
  });
});

describe('drawPlanAt / visualClipsAt with a transition', () => {
  const asset: Asset = { id: 'v', kind: 'video', name: 'v', duration: 30, fileRef: {} };
  function project() {
    const p = createProject('t');
    p.assets = { v: asset };
    const vt = createTrack('video');
    p.tracks = [vt];
    insertClip(vt, { ...createClip(asset, 0), id: 'a', duration: 4 });
    insertClip(vt, { ...createClip(asset, 4), id: 'b', duration: 4 });
    setTransition(p, 'a', 'b', 'crossfade', 1);
    return p;
  }

  it('switches between plain clips and the transition window around the cut', () => {
    const p = project();
    expect(drawPlanAt(p, 3.4)).toEqual([expect.objectContaining({ kind: 'clip', clip: expect.objectContaining({ id: 'a' }) })]);
    const mid = drawPlanAt(p, 4);
    expect(mid).toHaveLength(1);
    expect(mid[0]).toMatchObject({ kind: 'transition', progress: 0.5 });
    expect(drawPlanAt(p, 4.5)[0]).toMatchObject({ kind: 'clip', clip: { id: 'b' } });
  });

  it('needs frames of both clips inside the window only', () => {
    const p = project();
    expect(visualClipsAt(p, 3.6).map((x) => x.clip.id)).toEqual(['a', 'b']);
    expect(visualClipsAt(p, 4.4).map((x) => x.clip.id)).toEqual(['a', 'b']);
    expect(visualClipsAt(p, 3.4).map((x) => x.clip.id)).toEqual(['a']);
    expect(visualClipsAt(p, 4.6).map((x) => x.clip.id)).toEqual(['b']);
  });
});
