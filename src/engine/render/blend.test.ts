import { describe, expect, it } from 'vitest';
import { BLEND_GROUPS, BLEND_MODES } from '../../model/overlays';
import { blendPixels, dissolve, isPixelBlend, SEPARABLE } from './blend';

const px = (...v: number[]) => new Uint8ClampedArray(v);

describe('blend modes', () => {
  it('offers the After Effects list in its groups', () => {
    expect(BLEND_GROUPS.map((g) => g.length)).toEqual([3, 6, 7, 7, 5, 4]);
    expect(new Set(BLEND_MODES).size).toBe(32);
    // Native where the canvas has it; computed otherwise.
    expect(BLEND_MODES.filter(isPixelBlend)).toEqual([
      'dissolve', 'dancingDissolve', 'classicColorBurn', 'linearBurn', 'darkerColor', 'classicColorDodge', 'lighterColor',
      'linearLight', 'vividLight', 'pinLight', 'hardMix', 'subtract', 'divide',
    ]);
    for (const m of BLEND_MODES.filter(isPixelBlend)) if (!['dissolve', 'dancingDissolve', 'darkerColor', 'lighterColor'].includes(m)) expect(SEPARABLE[m]).toBeTypeOf('function');
  });

  it('separable formulas (backdrop a, source b)', () => {
    const f = SEPARABLE as Required<typeof SEPARABLE>;
    expect(f.linearBurn(0.8, 0.5)).toBeCloseTo(0.3);
    expect(f.linearLight(0.5, 0.75)).toBeCloseTo(1);
    expect(f.pinLight(0.8, 0.2)).toBeCloseTo(0.4);
    expect(f.pinLight(0.2, 0.8)).toBeCloseTo(0.6);
    expect([f.hardMix(0.6, 0.4), f.hardMix(0.6, 0.39)]).toEqual([1, 0]);
    expect(f.subtract(0.3, 0.5)).toBeCloseTo(-0.2); // clamped to 0 when applied
    expect(f.divide(0.25, 0.5)).toBeCloseTo(0.5);
    expect(f.divide(0.25, 0)).toBe(1);
    expect(f.vividLight(0.5, 0.25)).toBeCloseTo(0); // burn by 0.5
    expect(f.classicColorDodge(0.25, 0.5)).toBeCloseTo(0.5);
  });

  it('applies a lookup mode per channel, clamped, keeping the source alpha', () => {
    const src = px(37, 99, 235, 200);
    blendPixels('subtract', src, px(255, 0, 0, 255));
    expect([...src]).toEqual([218, 0, 0, 200]);
  });

  it('Lighter Color keeps the whole brighter pixel', () => {
    const src = px(0, 0, 255, 255, 0, 255, 0, 255);
    blendPixels('lighterColor', src, px(255, 0, 0, 255, 255, 0, 0, 255));
    // Blue (luma 29) loses to red (77); green (150) beats red.
    expect([...src]).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it('Dissolve shows each pixel fully or not at all, in proportion to its opacity, stable per seed', () => {
    const n = 20_000;
    const make = () => new Uint8ClampedArray(n * 4).map((_, i) => (i % 4 === 3 ? 64 : 9));
    const a = make();
    dissolve(a, 7);
    const alphas = a.filter((_, i) => i % 4 === 3);
    expect(alphas.every((v) => v === 0 || v === 255)).toBe(true);
    const shown = alphas.filter((v) => v === 255).length / n;
    expect(shown).toBeGreaterThan(0.22);
    expect(shown).toBeLessThan(0.28);
    const b = make();
    dissolve(b, 7);
    expect(b).toEqual(a);
    const c = make();
    dissolve(c, 8);
    expect(c).not.toEqual(a);
  });
});
