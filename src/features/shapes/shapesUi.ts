import type { ShapeKind } from '../../model/types';
import { Circle, Egg, Hexagon, PenTool, RectangleHorizontal, Slash, Square, Star, Triangle, type LucideIcon } from 'lucide-react';

export const SHAPE_ICONS: Record<ShapeKind, string> = {
  rectangle: '▬',
  square: '■',
  circle: '●',
  oval: '⬬',
  triangle: '▲',
  star: '★',
  polygon: '⬢',
  line: '╱',
  path: '✒',
};

/** Line icons for buttons; SHAPE_ICONS stays for plain-text places (select options, clip labels). */
export const SHAPE_LINE_ICONS: Record<ShapeKind, LucideIcon> = {
  rectangle: RectangleHorizontal,
  square: Square,
  circle: Circle,
  oval: Egg,
  triangle: Triangle,
  star: Star,
  polygon: Hexagon,
  line: Slash,
  path: PenTool,
};
