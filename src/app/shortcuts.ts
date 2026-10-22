import { useEffect } from 'react';
import {
  copySelection,
  deleteSelection,
  duplicateSelection,
  jumpToEdit,
  paste,
  seekToEnd,
  selectAll,
  splitAtPlayhead,
  stepFrames,
  zoomBy,
} from '../features/timeline/actions';
import { select, useTimelineUi } from '../features/timeline/timelineUi';
import { setTool, shapeToolKey, useTool } from '../features/tools/toolService';
import { stepDrawing } from '../features/paint/paintService';
import { jumpSelectedKeyframe, toggleSelectedKeyframe } from '../features/keyframes/keyframeService';
import { spaceDown } from '../features/preview/spaceHand';
import { useProjectStore } from '../store/projectStore';
import { useTransport } from '../store/transport';
import { useShortcutSheet } from './ShortcutSheet';
import { toggleMarkerAtPlayhead } from '../features/timeline/beatActions';

type Handler = (e: KeyboardEvent) => void;

function stepSelectedDrawing(dir: -1 | 1) {
  const sel = useTimelineUi.getState().selection;
  if (sel.length === 1) stepDrawing(sel[0], dir);
}

// Keyed by KeyboardEvent.code so letters also work with a Persian keyboard layout.
const WITH_CTRL: Record<string, Handler> = {
  KeyZ: (e) => (e.shiftKey ? useProjectStore.getState().redo() : useProjectStore.getState().undo()),
  KeyY: () => useProjectStore.getState().redo(),
  KeyC: copySelection,
  KeyV: () => paste(),
  KeyD: duplicateSelection,
  KeyA: selectAll,
  Equal: () => zoomBy(1.5),
  NumpadAdd: () => zoomBy(1.5),
  Minus: () => zoomBy(1 / 1.5),
  NumpadSubtract: () => zoomBy(1 / 1.5),
};

const PLAIN: Record<string, Handler> = {
  Space: (e) => spaceDown(e) || useTransport.getState().toggle(),
  KeyS: splitAtPlayhead,
  KeyM: toggleMarkerAtPlayhead,
  Delete: (e) => deleteSelection(e.shiftKey),
  Backspace: (e) => deleteSelection(e.shiftKey),
  ArrowLeft: (e) => stepFrames(e.shiftKey ? -10 : -1),
  ArrowRight: (e) => stepFrames(e.shiftKey ? 10 : 1),
  ArrowUp: () => jumpToEdit(-1),
  ArrowDown: () => jumpToEdit(1),
  Home: () => useTransport.getState().seek(0),
  End: seekToEnd,
  // Escape leaves a tool first, then clears the selection.
  Escape: () => (useTool.getState().tool !== 'select' ? setTool('select') : select([])),
  // The preview's tools, with After Effects' keys: selection, hand, pen (a mask on the selected
  // clip), shapes (Q again: the next shape), type, brush and eraser.
  KeyV: () => setTool('select'),
  KeyH: () => setTool('hand'),
  KeyG: () => setTool('pen'),
  KeyQ: shapeToolKey,
  KeyT: () => setTool('text'),
  // Shift+B: the clone stamp.
  KeyB: (e) => setTool(e.shiftKey ? 'clone' : 'brush'),
  KeyE: () => setTool('eraser'),
  // Previous / next drawing of the selected frame-by-frame paint.
  Comma: () => stepSelectedDrawing(-1),
  Period: () => stepSelectedDrawing(1),
  // Keyframes on the selected clip at the playhead (InShot's ◆ button), previous / next keyframe.
  KeyK: toggleSelectedKeyframe,
  BracketLeft: () => jumpSelectedKeyframe(-1),
  BracketRight: () => jumpSelectedKeyframe(1),
  // '?' (Shift + /); the same physical key gives '؟' on a Persian layout.
  Slash: (e) => e.shiftKey && useShortcutSheet.setState({ open: true }),
};

function isTypingTarget(el: EventTarget | null) {
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/** App-wide keyboard shortcuts. Text fields keep their native behaviour (including their own undo). */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target) || e.altKey) return;
      const handler = (e.ctrlKey || e.metaKey ? WITH_CTRL : PLAIN)[e.code];
      if (!handler) return;
      e.preventDefault();
      handler(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
