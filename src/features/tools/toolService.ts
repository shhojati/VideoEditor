// The preview's tools (After Effects' toolbar): select, hand, pen, shape, type, brush, clone stamp
// and eraser.
// The active tool decides what a click or drag on the preview does.
import { create } from 'zustand';
import { SHAPE_KINDS } from '../../model/overlays';
import type { ID, ShapeKind } from '../../model/types';
import { cancelPen, startPen, startShapePen, useMasks } from '../masks/maskService';
import { useTimelineUi } from '../timeline/timelineUi';

export type Tool = 'select' | 'hand' | 'pen' | 'shape' | 'text' | 'brush' | 'clone' | 'eraser';

/**
 * The clone stamp's source: a point in the layer units of the clip it was set on (`clipId`, or
 * none for a new paint layer). Once a stroke starts, `offset` (source − painted point) is kept
 * for the next strokes too (After Effects' "Aligned").
 */
export interface CloneSource {
  clipId: string | undefined;
  x: number;
  y: number;
  offset?: { dx: number; dy: number };
}

/** The brush (and eraser) settings new strokes get. */
export interface BrushSettings {
  color: string;
  /** Diameter in project pixels. */
  size: number;
  /** 0..1 */
  hardness: number;
  opacity: number;
  /** How long a new stroke shows: to the clip's end, one frame, or `seconds`. */
  duration: 'constant' | 'frame' | 'custom';
  seconds: number;
  /** Write On: seconds the stroke takes to draw itself (0: off). */
  writeOn: number;
  /** A new paint layer starts in frame-by-frame mode (drawings on twos). */
  frameByFrame: boolean;
}

export const BRUSH_DEFAULTS: BrushSettings = { color: '#ff3b30', size: 24, hardness: 0.8, opacity: 1, duration: 'constant', seconds: 1, writeOn: 0, frameByFrame: false };

const BRUSH_KEY = 'video-editor:brush';

function loadBrush(): BrushSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(BRUSH_KEY) ?? 'null') as Partial<BrushSettings> | null;
    return { ...BRUSH_DEFAULTS, ...saved };
  } catch {
    return BRUSH_DEFAULTS;
  }
}

interface ToolState {
  tool: Tool;
  /** What the shape tool draws. */
  shapeKind: ShapeKind;
  /**
   * A text clip being typed into on the preview; `key` merges the typing (and a new clip) into one
   * undo step. A new clip left empty is taken back.
   */
  editingText: { clipId: ID; key: string; created: boolean } | null;
  brush: BrushSettings;
  /** Onion skin: the drawings before and after show faintly on the preview (frame-by-frame paint). */
  onion: boolean;
  cloneSource: CloneSource | null;
}

export const useTool = create<ToolState>()(() => ({ tool: 'select', shapeKind: 'rectangle', editingText: null, brush: loadBrush(), onion: true, cloneSource: null }));

/** Change the brush settings (remembered on this device). */
export function setBrush(change: Partial<BrushSettings>) {
  const brush = { ...useTool.getState().brush, ...change };
  useTool.setState({ brush });
  try {
    localStorage.setItem(BRUSH_KEY, JSON.stringify(brush));
  } catch {
    // Storage may be unavailable (private window); the settings still apply for now.
  }
}

export function setTool(tool: Tool) {
  if (useTool.getState().tool === 'pen' && tool !== 'pen' && useMasks.getState().pen) cancelPen();
  useTool.setState({ tool });
  if (tool === 'pen') armPen();
}

/** The pen draws a mask on the selected clip, or with nothing selected a new shape (as in After Effects). */
function armPen() {
  const sel = useTimelineUi.getState().selection;
  if (sel.length === 1) startPen(sel[0]);
  else if (!sel.length) startShapePen();
  if (!useMasks.getState().pen) useTool.setState({ tool: 'select' });
}

/** Q again while drawing shapes picks the next kind, as in After Effects. */
export function shapeToolKey() {
  const { tool, shapeKind } = useTool.getState();
  if (tool !== 'shape') return setTool('shape');
  const i = SHAPE_KINDS.indexOf(shapeKind as (typeof SHAPE_KINDS)[number]);
  useTool.setState({ shapeKind: SHAPE_KINDS[(i + 1) % SHAPE_KINDS.length] });
}

export const editText = (clipId: ID, key: string, created = false) => useTool.setState({ editingText: { clipId, key, created } });
export const stopEditingText = () => useTool.setState({ editingText: null });

// A finished or cancelled pen path hands the preview back to the selection tool, so the new mask
// can be edited right away.
useMasks.subscribe((s, prev) => {
  if (prev.pen && !s.pen && useTool.getState().tool === 'pen') useTool.setState({ tool: 'select' });
});
