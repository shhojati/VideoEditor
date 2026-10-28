// Overlay clips (text and shapes, on 'text' tracks) and per-clip blend modes.
import { pathBounds } from './masks';
import type { BlendMode, Clip, MaskVertex, ShapeKind, ShapeProps, TextProps } from './types';

export const SHAPE_KINDS = ['rectangle', 'square', 'circle', 'oval', 'triangle', 'star', 'polygon', 'line'] as const satisfies readonly ShapeKind[];

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
export const isPaintLayer = (clip: Clip) =>
  !!clip.paint && !clip.assetId && !clip.sequenceId && !clip.text && !clip.shape && !clip.adjustment && !clip.solid && !clip.nullObject;

/** Text, shape, paint, solid, null or adjustment layer: no media file to decode. */
export const isOverlay = (clip: Clip) => !!(clip.text || clip.shape || clip.adjustment || clip.solid || clip.nullObject) || isPaintLayer(clip);

/** A shape drawn with the pen. */
export const isPathShape = (clip: Clip) => clip.shape?.kind === 'path' && !!clip.shape.path;

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
    case 'polygon':
      return { ...base, fill: '#10b981', strokeWidth: 0, sides: 6 };
    default:
      return { ...base, fill: '#2563eb', strokeWidth: 0 };
  }
}

/**
 * A path shape from Bézier points (project pixels in any frame): the points centred on their own
 * middle, filled when closed, a white line when open. `centre` is where that middle was.
 */
export function pathShape(path: readonly MaskVertex[], closed: boolean): { shape: ShapeProps; centre: { x: number; y: number } } {
  const b = pathBounds([...path]);
  const mx = b.x + b.width / 2;
  const my = b.y + b.height / 2;
  return {
    shape: {
      ...defaultShape('path'),
      width: Math.max(4, Math.round(b.width)),
      height: Math.max(4, Math.round(b.height)),
      path: { value: path.map(([x, y, ix, iy, ox, oy]): MaskVertex => [x - mx, y - my, ix, iy, ox, oy]) },
      closed,
      ...(closed ? { fill: '#2563eb', strokeWidth: 0 } : { fill: undefined, stroke: '#ffffff', strokeWidth: 8 }),
    },
    centre: { x: mx, y: my },
  };
}

/** A shape's shadow offset (project px at scale 1): its own, or the old default of 2 % of its size down. */
export const shadowOffset = (s: ShapeProps) =>
  s.shadowX !== undefined || s.shadowY !== undefined
    ? { shadowX: s.shadowX ?? 0, shadowY: s.shadowY ?? 0 }
    : { shadowX: 0, shadowY: Math.round(Math.max(s.width, s.height) * 0.02 * 10) / 10 };

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
  if (kind === 'polygon') s.sides ??= 6;
}
