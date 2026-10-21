import { describe, expect, it } from 'vitest';
import { applyHomography, curveLut, homography, invert2, levelsLut, particlesAt, transformMatrix } from '../engine/effects/math';
import en from '../i18n/en.json';
import { createEffect, defaultParams, EFFECT_DEFS, EFFECT_MENU, moveEffect, setFilter, transitionCompletion } from './effects';
import { createProject } from './factories';
import { LOOK_IDS, LOOK_MENU } from './looks';
import { addAdjustmentClip, findClip } from './timeline';
import { parseProject } from './validate';

describe('effect catalog', () => {
  it("lists After Effects' menu, with the heavy analysis effects marked for later", () => {
    expect(EFFECT_MENU.map((m) => m.kinds.length)).toEqual([6, 7, 6, 6, 7, 4, 4, 3, 3, 5]);
    const later = Object.values(EFFECT_DEFS).filter((d) => d.later).map((d) => d.kind);
    expect(later.sort()).toEqual(['cameraTracker3d', 'forceMotionBlur', 'keylight', 'shatter', 'timewarp', 'warpStabilizer']);
  });

  it('every parameter has a valid default and a label; every option and name is translated', () => {
    const t = en.effects as unknown as { names: Record<string, string>; params: Record<string, string>; options: Record<string, string> };
    for (const def of Object.values(EFFECT_DEFS)) {
      expect(t.names[def.kind], def.kind).toBeTruthy();
      for (const p of def.params) {
        expect(t.params[p.key], `${def.kind}.${p.key}`).toBeTruthy();
        if (p.type === 'number') expect(p.default >= p.min && p.default <= p.max, `${def.kind}.${p.key}`).toBe(true);
        if (p.type === 'select') {
          expect(p.options).toContain(p.default);
          if (p.key !== 'preset') for (const o of p.options) expect(t.options[o], `${def.kind}.${p.key}=${o}`).toBeTruthy();
        }
      }
    }
  });

  it('filters: every listed preset exists and is named; Noir and VHS appear twice', () => {
    const ids = LOOK_MENU.flatMap((g) => g.ids);
    expect(ids).toHaveLength(42);
    for (const id of ids) expect(LOOK_IDS).toContain(id);
    for (const id of LOOK_IDS) expect((en.filters.names as Record<string, string>)[id], id).toBeTruthy();
    expect(ids.filter((i) => i === 'noir' || i === 'vhs')).toHaveLength(4);
  });

  it('points are stored as X/Y fractions; created effects survive validation; adjustment layers too', () => {
    expect(defaultParams('lensFlare')).toMatchObject({ centerX: 0.3, centerY: 0.3, brightness: 100, lens: 'zoom' });
    const p = createProject('t');
    const id = addAdjustmentClip(p, 1, [createEffect('gaussianBlur', { blurriness: 30 }), createEffect('look', { preset: 'noir' })]);
    const back = findClip(parseProject(JSON.parse(JSON.stringify(p))), id)!;
    expect(back.track.kind).toBe('text');
    expect(back.clip).toMatchObject({ adjustment: true, duration: 5, effects: [{ kind: 'gaussianBlur', params: { blurriness: 30 } }, { kind: 'look', params: { preset: 'noir' } }] });
  });

  it('one filter per clip: applying another changes the preset and keeps the intensity', () => {
    const p = createProject('t');
    const clip = findClip(p, addAdjustmentClip(p, 0))!.clip;
    setFilter(clip, 'warm');
    clip.effects![0].params.intensity = 40;
    clip.effects!.unshift(createEffect('sharpen'));
    setFilter(clip, 'noir');
    expect(clip.effects!.map((e) => [e.kind, e.params.preset, e.params.intensity])).toEqual([
      ['sharpen', undefined, undefined],
      ['look', 'noir', 40],
    ]);
    moveEffect(clip, clip.effects![1].id, -1);
    expect(clip.effects![0].kind).toBe('look');
  });

  it('transition effects animate their completion over the clip start or end', () => {
    const wipe = createEffect('linearWipe', { animate: 'in', animDuration: 2 });
    expect([0, 1, 2, 5].map((t) => transitionCompletion(wipe, t, 6))).toEqual([1, 0.5, 0, 0]);
    wipe.params.animate = 'out';
    expect([0, 4, 5, 6].map((t) => transitionCompletion(wipe, t, 6))).toEqual([0, 0, 0.5, 1]);
    wipe.params.animate = 'none';
    wipe.params.completion = 30;
    expect(transitionCompletion(wipe, 3, 6)).toBeCloseTo(0.3);
  });
});

describe('effect maths', () => {
  it('curves: identity points give an identity table, and the curve never overshoots', () => {
    const id = curveLut([0, 0.25, 0.5, 0.75, 1]);
    for (let v = 0; v < 256; v += 17) expect(Math.abs(id[v * 4] - v)).toBeLessThanOrEqual(1);
    const s = curveLut([0, 0.1, 0.5, 0.9, 1]);
    for (let v = 1; v < 256; v++) expect(s[v * 4]).toBeGreaterThanOrEqual(s[(v - 1) * 4]); // monotone
    expect(s[64 * 4]).toBeLessThan(64); // an S curve darkens shadows
  });

  it('levels: input range, gamma and output range', () => {
    const l = levelsLut(50, 200, 1, 10, 240);
    expect([l[0], l[50 * 4], l[125 * 4], l[200 * 4], l[255 * 4]]).toEqual([10, 10, 125, 240, 240]);
    expect(levelsLut(0, 255, 2, 0, 255)[64 * 4]).toBeGreaterThan(100); // gamma > 1 brightens mids
  });

  it('corner pin homography maps the four corners exactly', () => {
    const from: [number, number][] = [[0, 0], [100, 0], [0, 100], [100, 100]];
    const to: [number, number][] = [[10, 5], [90, 20], [0, 110], [120, 95]];
    const h = homography(from, to);
    from.forEach((p, i) => {
      const [x, y] = applyHomography(h, p);
      expect(x).toBeCloseTo(to[i][0]);
      expect(y).toBeCloseTo(to[i][1]);
    });
  });

  it('transform matrix: 90° clockwise on screen, scale, and its inverse', () => {
    const m = transformMatrix(2, 90, 0, 0);
    // y up: the up vector (0, 1) turns clockwise to the right (1, 0), doubled.
    expect(m[0] * 0 + m[1] * 1).toBeCloseTo(2);
    expect(m[2] * 0 + m[3] * 1).toBeCloseTo(0);
    const inv = invert2(m);
    expect(inv[0] * m[0] + inv[1] * m[2]).toBeCloseTo(1);
  });

  it('particles are deterministic, born at the birth rate and gone after their longevity', () => {
    const p = { x: 100, y: 100, birthRate: 10, longevity: 1, velocity: 50, spread: 30, gravity: 0, size: 4, depth: 0 };
    expect(particlesAt(0.55, p)).toEqual(particlesAt(0.55, p));
    expect(particlesAt(0.55, p)).toHaveLength(6); // born at 0, 0.1, … 0.5
    expect(particlesAt(5, p)).toHaveLength(10); // steady state: rate × longevity
    // Rising (spread around straight up) without gravity.
    for (const q of particlesAt(0.55, p)) expect(q.y).toBeLessThanOrEqual(100);
  });
});
