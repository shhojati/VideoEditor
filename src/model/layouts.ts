// Layouts: picture-in-picture, split screens and creative shapes. Applying one stacks the selected
// clips on new tracks over the same time and fits each into its cell (crop + scale + position, a
// mask for non-rectangular or rounded cells, and border/shadow effects). Only existing clip
// settings are used, so preview and export need nothing new.
import { createEffect } from './effects';
import { createTrack, newId } from './factories';
import { ellipsePath, KAPPA } from './masks';
import type { Clip, ID, MaskVertex, Project, RotoMask, Track } from './types';

export type LayoutCategory = 'pip' | 'split' | 'creative';

export interface LayoutCell {
  /** Rectangle in fractions of the frame, from the top-left. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corner radius (project pixels), or the cell's own outline (fractions of the cell). */
  radius?: number;
  shape?: 'circle' | { polygon: [number, number][] };
  border?: boolean;
  shadow?: boolean;
}

export interface Layout {
  id: string;
  category: LayoutCategory;
  /** Cells for a frame of W×H, bottom first (the first selected clip goes in cell 0). */
  cells: (W: number, H: number) => LayoutCell[];
}

const FULL: LayoutCell = { x: 0, y: 0, w: 1, h: 1 };
/** Space between split cells (project pixels). */
const GAP = 8;

/** A grid of cells (fractions) with GAP between them. */
function grid(W: number, H: number, rects: [number, number, number, number][]): LayoutCell[] {
  const gx = GAP / 2 / W;
  const gy = GAP / 2 / H;
  return rects.map(([x, y, w, h]) => ({ x: x + (x > 0 ? gx : 0), y: y + (y > 0 ? gy : 0), w: w - (x > 0 ? gx : 0) - (x + w < 1 ? gx : 0), h: h - (y > 0 ? gy : 0) - (y + h < 1 ? gy : 0) }));
}

function pip(corner: 'tl' | 'tr' | 'bl' | 'br') {
  return (W: number, H: number): LayoutCell[] => {
    const m = 0.04 * Math.min(W, H);
    const w = 0.32;
    const h = 0.32;
    const x = corner.endsWith('l') ? m / W : 1 - w - m / W;
    const y = corner.startsWith('t') ? m / H : 1 - h - m / H;
    return [FULL, { x, y, w, h, radius: 0.03 * Math.min(W, H), border: true, shadow: true }];
  };
}

export const LAYOUTS: Layout[] = [
  { id: 'pipTopLeft', category: 'pip', cells: pip('tl') },
  { id: 'pipTopRight', category: 'pip', cells: pip('tr') },
  { id: 'pipBottomLeft', category: 'pip', cells: pip('bl') },
  { id: 'pipBottomRight', category: 'pip', cells: pip('br') },
  { id: 'split2h', category: 'split', cells: (W, H) => grid(W, H, [[0, 0, 0.5, 1], [0.5, 0, 0.5, 1]]) },
  { id: 'split2v', category: 'split', cells: (W, H) => grid(W, H, [[0, 0, 1, 0.5], [0, 0.5, 1, 0.5]]) },
  { id: 'split3h', category: 'split', cells: (W, H) => grid(W, H, [[0, 0, 1 / 3, 1], [1 / 3, 0, 1 / 3, 1], [2 / 3, 0, 1 / 3, 1]]) },
  { id: 'split3v', category: 'split', cells: (W, H) => grid(W, H, [[0, 0, 1, 1 / 3], [0, 1 / 3, 1, 1 / 3], [0, 2 / 3, 1, 1 / 3]]) },
  { id: 'split4', category: 'split', cells: (W, H) => grid(W, H, [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]]) },
  {
    id: 'diagonal',
    category: 'creative',
    cells: () => [
      { ...FULL, shape: { polygon: [[0, 0], [0.6, 0], [0.4, 1], [0, 1]] } },
      { ...FULL, shape: { polygon: [[0.6, 0], [1, 0], [1, 1], [0.4, 1]] }, shadow: true },
    ],
  },
  {
    id: 'circle',
    category: 'creative',
    cells: (W, H) => {
      const s = 0.5 * Math.min(W, H);
      return [FULL, { x: 0.5 - s / W / 2, y: 0.5 - s / H / 2, w: s / W, h: s / H, shape: 'circle', border: true, shadow: true }];
    },
  },
  { id: 'collage1plus2', category: 'creative', cells: (W, H) => grid(W, H, [[0, 0, 0.6, 1], [0.6, 0, 0.4, 0.5], [0.6, 0.5, 0.4, 0.5]]) },
  { id: 'collage1plus3', category: 'creative', cells: (W, H) => grid(W, H, [[0, 0, 1, 0.6], [0, 0.6, 1 / 3, 0.4], [1 / 3, 0.6, 1 / 3, 0.4], [2 / 3, 0.6, 1 / 3, 0.4]]) },
];

export const LAYOUT_CATEGORIES: LayoutCategory[] = ['pip', 'split', 'creative'];

/** A rectangle with rounded corners as a mask path (clockwise from the top-left). */
export function roundedRectPath(x: number, y: number, w: number, h: number, r: number): MaskVertex[] {
  const k = r * KAPPA;
  return [
    [x + r, y, -k, 0, 0, 0],
    [x + w - r, y, 0, 0, k, 0],
    [x + w, y + r, 0, -k, 0, 0],
    [x + w, y + h - r, 0, 0, 0, k],
    [x + w - r, y + h, k, 0, 0, 0],
    [x + r, y + h, 0, 0, -k, 0],
    [x, y + h - r, 0, k, 0, 0],
    [x, y + r, 0, 0, 0, -k],
  ];
}

const mask = (name: string, path: MaskVertex[]): RotoMask => ({
  id: newId(),
  name,
  mode: 'add',
  path: { value: path },
  feather: { value: 0 },
  expansion: { value: 0 },
  opacity: { value: 1 },
});

/**
 * Fit a clip into a cell: crop the source to the cell's shape (centred), scale it to the cell and
 * move it there; masks and border/shadow effects for its outline. Effects added by an earlier
 * layout are replaced, the clip's other effects kept.
 */
export function fitToCell(clip: Clip, cell: LayoutCell, srcW: number, srcH: number, W: number, H: number) {
  const cellAspect = (cell.w * W) / (cell.h * H);
  const srcAspect = srcW / srcH;
  const crop = srcAspect > cellAspect ? { x: (1 - cellAspect / srcAspect) / 2, y: 0, width: cellAspect / srcAspect, height: 1 } : { x: 0, y: (1 - srcAspect / cellAspect) / 2, width: 1, height: srcAspect / cellAspect };
  const visW = srcW * crop.width;
  const visH = srcH * crop.height;
  const contain = Math.min(W / visW, H / visH);
  clip.transform = {
    ...clip.transform,
    x: cell.x + cell.w / 2 - 0.5,
    y: cell.y + cell.h / 2 - 0.5,
    scale: (cell.w * W) / (visW * contain),
    rotation: 0,
    fit: 'contain',
    ...(crop.width < 1 - 1e-9 || crop.height < 1 - 1e-9 ? { crop } : { crop: undefined }),
  };
  if (!clip.transform.crop) delete clip.transform.crop;
  // The outline, in source pixels of the visible part (masks are in the clip's own pixels).
  const vx = crop.x * srcW;
  const vy = crop.y * srcH;
  const k = visW / (cell.w * W); // source px per project px
  const masks: RotoMask[] = [];
  if (cell.shape === 'circle') masks.push(mask('Layout', ellipsePath(vx + visW / 2, vy + visH / 2, visW, visH)));
  else if (cell.shape) masks.push(mask('Layout', cell.shape.polygon.map(([px, py]): MaskVertex => [vx + px * visW, vy + py * visH, 0, 0, 0, 0])));
  else if (cell.radius) masks.push(mask('Layout', roundedRectPath(vx, vy, visW, visH, Math.min(cell.radius * k, visW / 2, visH / 2))));
  if (masks.length) clip.masks = masks;
  else delete clip.masks;
  const kept = (clip.effects ?? []).filter((e) => !e.params.fromLayout);
  const added = [
    ...(cell.border ? [createEffect('stroke', { color: '#ffffff', size: 6, fromLayout: true })] : []),
    ...(cell.shadow ? [createEffect('dropShadow', { opacity: 60, distance: 12, softness: 24, fromLayout: true })] : []),
  ];
  clip.effects = [...kept, ...added];
  if (!clip.effects.length) delete clip.effects;
}

/** Clips a layout can use: video and image clips on unlocked tracks, bottom track first. */
export function layoutClips(p: Project, ids: readonly ID[]): { clip: Clip; track: Track }[] {
  const picked = new Set(ids);
  return p.tracks.flatMap((track) =>
    track.locked
      ? []
      : track.clips.filter((c) => picked.has(c.id) && c.assetId && ['video', 'image'].includes(p.assets[c.assetId]?.kind ?? '')).map((clip) => ({ clip, track })),
  );
}

/**
 * Put the selected clips (as many as the layout has cells) on new tracks above the highest of
 * them, all starting where the earliest one starts, each fitted into its cell. Tracks left empty
 * are removed, so trying one layout after another doesn't pile up tracks. Returns the clips' ids.
 */
export function applyLayout(p: Project, layout: Layout, ids: readonly ID[]): ID[] {
  const { width: W, height: H } = p.settings;
  const cells = layout.cells(W, H);
  const used = layoutClips(p, ids).slice(0, cells.length);
  if (!used.length) return [];
  // Over a full-frame background (picture-in-picture, circle), fewer clips take the inner cells:
  // one clip becomes the small picture over whatever is below it.
  const bg = cells[0];
  const first = used.length < cells.length && !bg.shape && bg.x === 0 && bg.y === 0 && bg.w === 1 && bg.h === 1 ? cells.length - used.length : 0;
  const t0 = Math.min(...used.map((u) => u.clip.start));
  const top = Math.max(...used.map((u) => p.tracks.indexOf(u.track)));
  const sources = new Set(used.map((u) => u.track.id));
  for (const { clip, track } of used) track.clips = track.clips.filter((c) => c.id !== clip.id);
  const stacked = used.map(({ clip }, i): Track => {
    const asset = p.assets[clip.assetId!];
    fitToCell(clip, cells[first + i], asset?.width ?? W, asset?.height ?? H, W, H);
    clip.start = t0;
    return { ...createTrack('video'), clips: [clip] };
  });
  p.tracks.splice(top + 1, 0, ...stacked);
  p.tracks = p.tracks.filter((t) => !(sources.has(t.id) && !t.clips.length));
  return used.map((u) => u.clip.id);
}
