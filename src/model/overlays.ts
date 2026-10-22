// Overlay clips (text and shapes, on 'text' tracks) and per-clip blend modes.
import type { BlendMode, Clip, ShapeKind, ShapeProps, TextProps } from './types';

export const SHAPE_KINDS = ['rectangle', 'square', 'circle', 'oval', 'triangle', 'star', 'line'] as const satisfies readonly ShapeKind[];

/** Grouped as in After Effects' blend mode menu: normal | darken | lighten | contrast | difference | component. */
export const BLEND_GROUPS: readonly (readonly BlendMode[])[] = [
  ['normal', 'dissolve', 'dancingDissolve'],
  ['darken', 'multiply', 'colorBurn', 'classicColorBurn', 'linearBurn', 'darkerColor'],
  ['add', 'lighten', 'screen', 'colorDodge', 'classicColorDodge', 'linearDodge', 'lighterColor'],
  ['overlay', 'softLight', 'hardLight', 'linearLight', 'vividLight', 'pinLight', 'hardMix'],
  ['difference', 'classicDifference', 'exclusion', 'subtract', 'divide'],
  ['hue', 'saturation', 'color', 'luminosity'],
];

export const BLEND_MODES = BLEND_GROUPS.flat() as [BlendMode, ...BlendMode[]];

/** A clip that is only brush strokes (no media under them). */
export const isPaintLayer = (clip: Clip) => !!clip.paint && !clip.assetId && !clip.sequenceId && !clip.text && !clip.shape && !clip.adjustment;

/** Text, shape, paint or adjustment layer: no media file to decode. */
export const isOverlay = (clip: Clip) => !!(clip.text || clip.shape || clip.adjustment) || isPaintLayer(clip);

/** Shapes whose width and height are kept equal. */
export const keepsAspect = (kind: ShapeKind) => kind === 'square' || kind === 'circle';

/** How a new text clip looks (its words and direction come from what is typed). */
export const TEXT_STYLE_DEFAULTS: Omit<TextProps, 'content' | 'rtl'> = {
  fontFamily: 'Vazirmatn',
  fontSize: 72,
  fontWeight: 700,
  color: '#ffffff',
  strokeColor: '#000000',
  strokeWidth: 6,
  align: 'center',
  fadeIn: 0,
  fadeOut: 0,
};

export const SHAPE_DEFAULT_SIZE = 300;

export function defaultShape(kind: ShapeKind): ShapeProps {
  const base = { kind, width: SHAPE_DEFAULT_SIZE, height: SHAPE_DEFAULT_SIZE, fadeIn: 0, fadeOut: 0 };
  switch (kind) {
    case 'line':
      return { ...base, width: 500, height: 1, stroke: '#ffffff', strokeWidth: 10, arrowEnd: false };
    case 'rectangle':
    case 'oval':
      return { ...base, width: 450, fill: '#2563eb', strokeWidth: 0 };
    case 'star':
      return { ...base, fill: '#facc15', strokeWidth: 0, points: 5, innerRadius: 0.5 };
    default:
      return { ...base, fill: '#2563eb', strokeWidth: 0 };
  }
}

/** Switch a shape's kind, keeping its size and colours where they still make sense. */
export function setShapeKind(s: ShapeProps, kind: ShapeKind) {
  if (s.kind === kind) return;
  const wasLine = s.kind === 'line';
  s.kind = kind;
  if (kind === 'line') {
    s.stroke ??= s.fill ?? '#ffffff';
    if (!s.strokeWidth) s.strokeWidth = 10;
    return;
  }
  if (wasLine) {
    s.height = Math.max(s.height, Math.round(s.width * 0.6));
    s.fill ??= s.stroke;
  }
  if (keepsAspect(kind)) s.height = s.width;
  if (kind === 'star') {
    s.points ??= 5;
    s.innerRadius ??= 0.5;
  }
}
