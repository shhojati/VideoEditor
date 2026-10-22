// The preview's tools (After Effects' toolbar): select, hand, pen, shape and type. The active tool
// decides what a click or drag on the preview does.
import { create } from 'zustand';
import { SHAPE_KINDS } from '../../model/overlays';
import type { ID, ShapeKind } from '../../model/types';
import { cancelPen, startPen, useMasks } from '../masks/maskService';
import { useTimelineUi } from '../timeline/timelineUi';

export type Tool = 'select' | 'hand' | 'pen' | 'shape' | 'text';

interface ToolState {
  tool: Tool;
  /** What the shape tool draws. */
  shapeKind: ShapeKind;
  /**
   * A text clip being typed into on the preview; `key` merges the typing (and a new clip) into one
   * undo step. A new clip left empty is taken back.
   */
  editingText: { clipId: ID; key: string; created: boolean } | null;
}

export const useTool = create<ToolState>()(() => ({ tool: 'select', shapeKind: 'rectangle', editingText: null }));

export function setTool(tool: Tool) {
  if (useTool.getState().tool === 'pen' && tool !== 'pen' && useMasks.getState().pen) cancelPen();
  useTool.setState({ tool });
  if (tool === 'pen') armPen();
}

/** The pen draws a mask on the selected clip; with nothing to draw on it falls back to selecting. */
function armPen() {
  const sel = useTimelineUi.getState().selection;
  if (sel.length === 1) startPen(sel[0]);
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
