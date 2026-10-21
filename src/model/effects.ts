// Effects: a per-clip stack (Clip.effects) applied in order to the clip's own pixels, or — on an
// adjustment layer — to everything below it. This file is the catalog: categories, parameter specs
// and defaults. Rendering lives in engine/effects.
import { newId } from './factories';
import { LOOK_IDS } from './looks';
import type { AssetKind, Clip, Effect, EffectKind, EffectParams, ID } from './types';

export type EffectCategory =
  | 'blurSharpen'
  | 'colorCorrection'
  | 'distort'
  | 'generate'
  | 'stylize'
  | 'perspective'
  | 'time'
  | 'simulation'
  | 'keying'
  | 'transition';

export type ParamSpec =
  | { key: string; type: 'number'; default: number; min: number; max: number; step?: number; unit?: string }
  | { key: string; type: 'color'; default: string }
  | { key: string; type: 'bool'; default: boolean }
  | { key: string; type: 'select'; default: string; options: readonly string[] }
  /** A point in the frame, as fractions (0..1) from the top-left; stored as `${key}X` / `${key}Y`. */
  | { key: string; type: 'point'; default: readonly [number, number] };

export interface EffectDef {
  kind: EffectKind;
  /** Display name (After Effects' names are kept in English; also translated in effects.names.*). */
  name: string;
  params: readonly ParamSpec[];
  /** Not built yet: listed in the pane, but cannot be added. */
  later?: boolean;
}

const num = (key: string, d: number, min: number, max: number, step?: number, unit?: string): ParamSpec => ({ key, type: 'number', default: d, min, max, step, unit });
const color = (key: string, d: string): ParamSpec => ({ key, type: 'color', default: d });
const bool = (key: string, d: boolean): ParamSpec => ({ key, type: 'bool', default: d });
const select = (key: string, d: string, options: readonly string[]): ParamSpec => ({ key, type: 'select', default: d, options });
const point = (key: string, x: number, y: number): ParamSpec => ({ key, type: 'point', default: [x, y] });

const DIMENSIONS = ['both', 'horizontal', 'vertical'] as const;
const CHANNELS = ['rgb', 'red', 'green', 'blue'] as const;
/** Transition effects run their completion from 0 → 100 % over the clip's start ('in') or end ('out'). */
const ANIMATE = [select('animate', 'in', ['none', 'in', 'out']), num('animDuration', 1, 0.1, 10, 0.1, 's')];

const defs: EffectDef[] = [
  // Blur & Sharpen
  { kind: 'gaussianBlur', name: 'Gaussian Blur', params: [num('blurriness', 10, 0, 200, 0.5, 'px'), select('dimensions', 'both', DIMENSIONS), bool('repeatEdge', false)] },
  { kind: 'fastBoxBlur', name: 'Fast Box Blur', params: [num('radius', 10, 0, 200, 0.5, 'px'), num('iterations', 3, 1, 5, 1), select('dimensions', 'both', DIMENSIONS), bool('repeatEdge', false)] },
  { kind: 'cameraLensBlur', name: 'Camera Lens Blur', params: [num('radius', 15, 0, 100, 0.5, 'px'), select('iris', 'circle', ['circle', 'hexagon']), num('highlightGain', 0, 0, 100, 1, '%'), num('highlightThreshold', 90, 0, 100, 1, '%')] },
  { kind: 'directionalBlur', name: 'Directional Blur', params: [num('direction', 0, -180, 180, 1, '°'), num('length', 20, 0, 300, 0.5, 'px')] },
  { kind: 'sharpen', name: 'Sharpen', params: [num('amount', 50, 0, 500, 1)] },
  { kind: 'unsharpMask', name: 'Unsharp Mask', params: [num('amount', 50, 0, 500, 1, '%'), num('radius', 2, 0.1, 50, 0.1, 'px'), num('threshold', 0, 0, 255, 1)] },
  // Color Correction
  {
    kind: 'lumetri',
    name: 'Lumetri Color',
    params: [
      num('exposure', 0, -4, 4, 0.05), num('contrast', 0, -100, 100, 1), num('highlights', 0, -100, 100, 1), num('shadows', 0, -100, 100, 1),
      num('whites', 0, -100, 100, 1), num('blacks', 0, -100, 100, 1), num('temperature', 0, -100, 100, 1), num('tint', 0, -100, 100, 1),
      num('saturation', 100, 0, 200, 1), num('vibrance', 0, -100, 100, 1), num('vignette', 0, -100, 100, 1),
    ],
  },
  { kind: 'curves', name: 'Curves', params: [select('channel', 'rgb', CHANNELS), num('p0', 0, 0, 100, 1, '%'), num('p25', 25, 0, 100, 1, '%'), num('p50', 50, 0, 100, 1, '%'), num('p75', 75, 0, 100, 1, '%'), num('p100', 100, 0, 100, 1, '%')] },
  { kind: 'levels', name: 'Levels', params: [select('channel', 'rgb', CHANNELS), num('inBlack', 0, 0, 255, 1), num('inWhite', 255, 0, 255, 1), num('gamma', 1, 0.1, 10, 0.01), num('outBlack', 0, 0, 255, 1), num('outWhite', 255, 0, 255, 1)] },
  { kind: 'hueSaturation', name: 'Hue/Saturation', params: [num('hue', 0, -180, 180, 1, '°'), num('saturation', 0, -100, 100, 1), num('lightness', 0, -100, 100, 1), bool('colorize', false), num('colorizeHue', 0, 0, 360, 1, '°'), num('colorizeSaturation', 25, 0, 100, 1)] },
  { kind: 'tint', name: 'Tint', params: [color('mapBlack', '#000000'), color('mapWhite', '#ffffff'), num('amount', 100, 0, 100, 1, '%')] },
  { kind: 'tritone', name: 'Tritone', params: [color('highlights', '#ffffff'), color('midtones', '#7f6440'), color('shadows', '#000000'), num('blend', 0, 0, 100, 1, '%')] },
  { kind: 'brightnessContrast', name: 'Brightness & Contrast', params: [num('brightness', 0, -150, 150, 1), num('contrast', 0, -100, 100, 1)] },
  // Distort
  { kind: 'transform', name: 'Transform', params: [point('position', 0.5, 0.5), num('scale', 100, 0, 400, 1, '%'), num('rotation', 0, -360, 360, 1, '°'), num('skew', 0, -70, 70, 1), num('skewAxis', 0, -180, 180, 1, '°'), num('opacity', 100, 0, 100, 1, '%')] },
  { kind: 'warpStabilizer', name: 'Warp Stabilizer', params: [], later: true },
  { kind: 'turbulentDisplace', name: 'Turbulent Displace', params: [num('amount', 50, 0, 300, 1), num('size', 100, 2, 600, 1, 'px'), num('complexity', 2, 1, 5, 1), num('evolution', 0, 0, 360, 1, '°'), num('speed', 30, 0, 360, 1, '°/s')] },
  { kind: 'displacementMap', name: 'Displacement Map', params: [select('map', 'below', ['below', 'self']), select('horizontal', 'red', ['red', 'green', 'blue', 'luminance']), num('maxHorizontal', 30, -300, 300, 1, 'px'), select('vertical', 'green', ['red', 'green', 'blue', 'luminance']), num('maxVertical', 30, -300, 300, 1, 'px')] },
  { kind: 'opticsCompensation', name: 'Optics Compensation', params: [num('fieldOfView', 0, 0, 120, 1, '°'), bool('reverse', false)] },
  { kind: 'powerPin', name: 'CC Power Pin', params: [point('topLeft', 0, 0), point('topRight', 1, 0), point('bottomLeft', 0, 1), point('bottomRight', 1, 1)] },
  // Generate
  { kind: 'fill', name: 'Fill', params: [color('color', '#ff0000'), num('opacity', 100, 0, 100, 1, '%')] },
  { kind: 'gradientRamp', name: 'Gradient Ramp', params: [point('start', 0.5, 0), color('startColor', '#000000'), point('end', 0.5, 1), color('endColor', '#ffffff'), select('shape', 'linear', ['linear', 'radial']), num('blend', 0, 0, 100, 1, '%')] },
  { kind: 'fourColorGradient', name: '4-Color Gradient', params: [point('point1', 0.1, 0.1), color('color1', '#ffff00'), point('point2', 0.9, 0.1), color('color2', '#00ff00'), point('point3', 0.1, 0.9), color('color3', '#ff00ff'), point('point4', 0.9, 0.9), color('color4', '#0000ff'), num('blend', 100, 1, 400, 1), num('opacity', 100, 0, 100, 1, '%')] },
  { kind: 'grid', name: 'Grid', params: [num('size', 60, 4, 1000, 1, 'px'), num('border', 2, 0, 100, 0.5, 'px'), color('color', '#ffffff'), num('opacity', 100, 0, 100, 1, '%'), bool('invert', false)] },
  { kind: 'lensFlare', name: 'Lens Flare', params: [point('center', 0.3, 0.3), num('brightness', 100, 10, 300, 1, '%'), select('lens', 'zoom', ['zoom', 'prime35', 'prime105'])] },
  { kind: 'stroke', name: 'Stroke', params: [color('color', '#ffffff'), num('size', 4, 0, 60, 0.5, 'px'), num('opacity', 100, 0, 100, 1, '%'), select('paint', 'onOriginal', ['onOriginal', 'strokeOnly'])] },
  // Stylize
  { kind: 'glow', name: 'Glow', params: [num('threshold', 60, 0, 100, 1, '%'), num('radius', 20, 0, 200, 0.5, 'px'), num('intensity', 1, 0, 5, 0.05), select('colors', 'original', ['original', 'color']), color('color', '#ffcc66')] },
  { kind: 'dropShadow', name: 'Drop Shadow', params: [color('color', '#000000'), num('opacity', 50, 0, 100, 1, '%'), num('direction', 135, -180, 180, 1, '°'), num('distance', 10, 0, 300, 0.5, 'px'), num('softness', 10, 0, 200, 0.5, 'px'), bool('shadowOnly', false)] },
  { kind: 'motionTile', name: 'Motion Tile', params: [point('center', 0.5, 0.5), num('tileWidth', 50, 5, 100, 1, '%'), num('tileHeight', 50, 5, 100, 1, '%'), bool('mirror', false)] },
  { kind: 'roughenEdges', name: 'Roughen Edges', params: [num('border', 8, 0, 100, 0.5, 'px'), num('sharpness', 1, 0.1, 10, 0.1), num('scale', 100, 5, 500, 1, '%'), num('evolution', 0, 0, 360, 1, '°')] },
  { kind: 'findEdges', name: 'Find Edges', params: [bool('invert', false), num('blend', 0, 0, 100, 1, '%')] },
  { kind: 'posterize', name: 'Posterize', params: [num('levels', 6, 2, 64, 1)] },
  { kind: 'mosaic', name: 'Mosaic', params: [num('blockSize', 20, 2, 400, 1, 'px'), bool('sharpColors', false)] },
  // Perspective
  { kind: 'cameraTracker3d', name: '3D Camera Tracker', params: [], later: true },
  { kind: 'bevelAlpha', name: 'Bevel Alpha', params: [num('thickness', 3, 0, 60, 0.5, 'px'), num('lightAngle', -60, -180, 180, 1, '°'), color('lightColor', '#ffffff'), num('intensity', 40, 0, 100, 1, '%')] },
  { kind: 'sphere', name: 'CC Sphere', params: [point('center', 0.5, 0.5), num('radius', 40, 5, 100, 1, '%'), num('rotationX', 0, -180, 180, 1, '°'), num('rotationY', 0, -180, 180, 1, '°'), num('light', 50, 0, 100, 1, '%')] },
  // Time
  { kind: 'echo', name: 'Echo', params: [num('echoTime', -0.1, -1, 1, 0.01, 's'), num('echoes', 3, 1, 12, 1), num('startIntensity', 100, 0, 100, 1, '%'), num('decay', 50, 0, 100, 1, '%'), select('operator', 'add', ['add', 'maximum', 'minimum', 'screen', 'behind', 'front'])] },
  { kind: 'posterizeTime', name: 'Posterize Time', params: [num('frameRate', 12, 1, 60, 1, 'fps')] },
  { kind: 'timewarp', name: 'Timewarp', params: [], later: true },
  { kind: 'forceMotionBlur', name: 'CC Force Motion Blur', params: [], later: true },
  // Simulation
  {
    kind: 'particleWorld',
    name: 'CC Particle World',
    params: [point('producer', 0.5, 0.6), num('birthRate', 60, 1, 400, 1, '/s'), num('longevity', 2, 0.1, 10, 0.1, 's'), num('velocity', 30, 0, 200, 1, '%'), num('gravity', 0, -100, 100, 1, '%'), num('size', 6, 1, 80, 0.5, 'px'), color('birthColor', '#ffe680'), color('deathColor', '#ff3300'), num('depth', 50, 0, 100, 1, '%')],
  },
  {
    kind: 'particleSystems',
    name: 'CC Particle Systems II',
    params: [point('producer', 0.5, 0.8), num('birthRate', 120, 1, 600, 1, '/s'), num('longevity', 1.5, 0.1, 10, 0.1, 's'), num('velocity', 60, 0, 300, 1, '%'), num('spread', 40, 0, 180, 1, '°'), num('gravity', 50, -100, 200, 1, '%'), num('size', 4, 1, 60, 0.5, 'px'), color('birthColor', '#ffffff'), color('deathColor', '#3366ff')],
  },
  { kind: 'shatter', name: 'Shatter', params: [], later: true },
  // Keying
  { kind: 'keylight', name: 'Keylight (1.2)', params: [], later: true },
  { kind: 'linearColorKey', name: 'Linear Color Key', params: [color('keyColor', '#00ff00'), num('tolerance', 20, 0, 100, 1, '%'), num('softness', 10, 0, 100, 1, '%'), num('spill', 50, 0, 100, 1, '%')] },
  { kind: 'colorRange', name: 'Color Range', params: [color('keyColor', '#00ff00'), num('hueRange', 30, 0, 180, 1, '°'), num('minSaturation', 25, 0, 100, 1, '%'), num('minLightness', 10, 0, 100, 1, '%'), num('maxLightness', 95, 0, 100, 1, '%'), num('softness', 10, 0, 100, 1, '%')] },
  // Transition
  { kind: 'linearWipe', name: 'Linear Wipe', params: [num('completion', 50, 0, 100, 1, '%'), num('angle', 90, -180, 180, 1, '°'), num('feather', 0, 0, 500, 1, 'px'), ...ANIMATE] },
  { kind: 'radialWipe', name: 'Radial Wipe', params: [num('completion', 50, 0, 100, 1, '%'), num('startAngle', 0, -180, 180, 1, '°'), point('center', 0.5, 0.5), select('wipe', 'clockwise', ['clockwise', 'counterclockwise', 'both']), num('feather', 0, 0, 180, 1, '°'), ...ANIMATE] },
  { kind: 'venetianBlinds', name: 'Venetian Blinds', params: [num('completion', 50, 0, 100, 1, '%'), num('direction', 0, -180, 180, 1, '°'), num('width', 60, 2, 600, 1, 'px'), num('feather', 0, 0, 100, 1, 'px'), ...ANIMATE] },
  { kind: 'blockDissolve', name: 'Block Dissolve', params: [num('completion', 50, 0, 100, 1, '%'), num('blockWidth', 24, 1, 400, 1, 'px'), num('blockHeight', 24, 1, 400, 1, 'px'), num('feather', 0, 0, 100, 1, '%'), ...ANIMATE] },
  { kind: 'gradientWipe', name: 'Gradient Wipe', params: [num('completion', 50, 0, 100, 1, '%'), num('softness', 10, 0, 100, 1, '%'), select('gradient', 'luminance', ['luminance', 'horizontal', 'vertical', 'radial', 'noise']), bool('invert', false), ...ANIMATE] },
  // Filters pane presets (not listed in the Effects pane).
  { kind: 'look', name: 'Filter', params: [select('preset', 'cinematic', LOOK_IDS), num('intensity', 100, 0, 100, 1, '%')] },
];

export const EFFECT_DEFS: Record<EffectKind, EffectDef> = Object.fromEntries(defs.map((d) => [d.kind, d])) as Record<EffectKind, EffectDef>;

/** The Effects pane, in After Effects' menu order. Drop Shadow is listed under Stylize and Perspective. */
export const EFFECT_MENU: readonly { category: EffectCategory; kinds: readonly EffectKind[] }[] = [
  { category: 'blurSharpen', kinds: ['gaussianBlur', 'fastBoxBlur', 'cameraLensBlur', 'directionalBlur', 'sharpen', 'unsharpMask'] },
  { category: 'colorCorrection', kinds: ['lumetri', 'curves', 'levels', 'hueSaturation', 'tint', 'tritone', 'brightnessContrast'] },
  { category: 'distort', kinds: ['transform', 'warpStabilizer', 'turbulentDisplace', 'displacementMap', 'opticsCompensation', 'powerPin'] },
  { category: 'generate', kinds: ['fill', 'gradientRamp', 'fourColorGradient', 'grid', 'lensFlare', 'stroke'] },
  { category: 'stylize', kinds: ['glow', 'dropShadow', 'motionTile', 'roughenEdges', 'findEdges', 'mosaic', 'posterize'] },
  { category: 'perspective', kinds: ['cameraTracker3d', 'bevelAlpha', 'sphere', 'dropShadow'] },
  { category: 'time', kinds: ['echo', 'posterizeTime', 'timewarp', 'forceMotionBlur'] },
  { category: 'simulation', kinds: ['particleWorld', 'particleSystems', 'shatter'] },
  { category: 'keying', kinds: ['keylight', 'linearColorKey', 'colorRange'] },
  { category: 'transition', kinds: ['linearWipe', 'radialWipe', 'venetianBlinds', 'blockDissolve', 'gradientWipe'] },
];

export const EFFECT_KINDS = defs.map((d) => d.kind) as [EffectKind, ...EffectKind[]];

/** Default values of every parameter (points as their X/Y pair). */
export function defaultParams(kind: EffectKind): EffectParams {
  const out: EffectParams = {};
  for (const p of EFFECT_DEFS[kind].params) {
    if (p.type === 'point') {
      out[`${p.key}X`] = p.default[0];
      out[`${p.key}Y`] = p.default[1];
    } else out[p.key] = p.default;
  }
  return out;
}

export function createEffect(kind: EffectKind, params: EffectParams = {}): Effect {
  return { id: newId(), kind, enabled: true, params: { ...defaultParams(kind), ...params } };
}

/** A parameter's value, falling back to the default (older documents, new parameters). */
export function param<T extends number | string | boolean>(e: Effect, key: string): T {
  const v = e.params[key];
  if (v !== undefined) return v as T;
  return defaultParams(e.kind)[key] as T;
}

/**
 * Completion of a transition effect at clip-local time `local` (s) for a clip of `duration`:
 * the static value, or animated 0 → 100 % from the clip start ('in': the clip is revealed) or to
 * its end ('out': it is wiped away).
 */
export function transitionCompletion(e: Effect, local: number, duration: number): number {
  const animate = param<string>(e, 'animate');
  if (animate === 'none') return param<number>(e, 'completion') / 100;
  const d = Math.max(0.01, Math.min(param<number>(e, 'animDuration'), duration));
  const p = Math.min(1, Math.max(0, animate === 'in' ? local / d : (duration - local) / d));
  // 'in' wipes the clip on (completion falls 1 → 0); 'out' wipes it off (0 → 1 at the end).
  return 1 - p;
}

export const isTransitionEffect = (kind: EffectKind) => EFFECT_MENU.find((m) => m.category === 'transition')!.kinds.includes(kind);

/** Clips that can carry effects: anything visual (media, text, shapes) and adjustment layers. */
export function acceptsEffects(clip: Clip, assetKind: AssetKind | undefined): boolean {
  return !!(clip.text || clip.shape || clip.adjustment || assetKind === 'video' || assetKind === 'image');
}

/**
 * Apply a Filters-pane preset: a clip has one filter at a time, so an existing filter changes
 * preset (keeping its intensity); otherwise a new one goes at the end of the stack.
 */
export function setFilter(clip: Clip, preset: string) {
  const existing = clip.effects?.find((e) => e.kind === 'look');
  if (existing) existing.params.preset = preset;
  else (clip.effects ??= []).push(createEffect('look', { preset }));
}

/** Move an effect up (-1) or down (1) in its stack. */
export function moveEffect(clip: Clip, effectId: ID, dir: -1 | 1) {
  const list = clip.effects ?? [];
  const i = list.findIndex((e) => e.id === effectId);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}
