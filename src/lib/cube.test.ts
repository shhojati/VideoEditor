import { describe, expect, it } from 'vitest';
import { wheelOffset } from '../engine/effects/applyEffects';
import { BUILTIN_LUT_IDS, builtinLut, encodeLut, lutTexture } from '../model/luts';
import { CubeError, formatCube, lutFrom, parseCube, sample3d } from './cube';

const invert = lutFrom(5, (r, g, b) => [1 - r, 1 - g, 1 - b]);

describe('parseCube', () => {
  it('reads a 3D table and samples it trilinearly', () => {
    const lut = parseCube(formatCube(invert, 'Invert'));
    expect(lut.size).toBe(5);
    expect(sample3d(lut, 0.3, 0.6, 0.9).map((v) => +v.toFixed(5))).toEqual([0.7, 0.4, 0.1]);
  });

  it('handles comments, DOMAIN_MAX and 1D tables', () => {
    // Domain 0..2: an input of 1.0 is the middle of the table.
    const text = ['# made by hand', 'LUT_3D_SIZE 2', 'DOMAIN_MIN 0 0 0', 'DOMAIN_MAX 2 2 2', ...[0, 1].flatMap((b) => [0, 1].flatMap((g) => [0, 1].map((r) => `${r} ${g} ${b}`)))].join('\n');
    const lut = parseCube(text);
    expect(sample3d(lut, 1, 1, 1).map((v) => +v.toFixed(3))).toEqual([0.5, 0.5, 0.5]);
    const oneD = parseCube(['LUT_1D_SIZE 2', '1 1 1', '0 0 0'].join('\n'));
    expect(sample3d(oneD, 0.25, 0.5, 1).map((v) => +v.toFixed(3))).toEqual([0.75, 0.5, 0]);
  });

  it('rejects broken files', () => {
    expect(() => parseCube('LUT_3D_SIZE 3\n0 0 0\n')).toThrow(CubeError);
    expect(() => parseCube('hello')).toThrow(CubeError);
  });
});

describe('project LUTs', () => {
  it('pack blue slices side by side for the shader', () => {
    const lut = encodeLut('Invert', invert);
    const tex = lutTexture(lut);
    expect(tex.length).toBe(5 ** 3 * 4);
    // Texel (x = r + b·5, y = g) holds the output for that input.
    const at = (r: number, g: number, b: number) => Array.from(tex.slice((g * 25 + b * 5 + r) * 4, (g * 25 + b * 5 + r) * 4 + 3));
    expect(at(0, 0, 0)).toEqual([255, 255, 255]);
    expect(at(4, 2, 1)).toEqual([0, 128, 191]);
  });

  it('builds every built-in look', () => {
    for (const id of BUILTIN_LUT_IDS) {
      const lut = builtinLut(id);
      expect(lut.size).toBe(33);
      expect(atob(lut.data).length).toBe(33 ** 3 * 3);
    }
  });
});

describe('wheelOffset', () => {
  it('is neutral at the centre and pushes towards the wheel’s hue', () => {
    expect(wheelOffset(0, 0, 0, 1)).toEqual([0, 0, 0]);
    const red = wheelOffset(1, 0, 0, 1); // angle 0 = red
    expect(red[0]).toBeGreaterThan(0.5);
    expect(red[1]).toBeLessThan(0);
    const blue = wheelOffset(Math.cos((4 * Math.PI) / 3), Math.sin((4 * Math.PI) / 3), 0, 1);
    expect(blue[2]).toBeGreaterThan(0.5);
    expect(wheelOffset(0, 0, 0.5, 0.5)).toEqual([0.25, 0.25, 0.25]);
  });
});
