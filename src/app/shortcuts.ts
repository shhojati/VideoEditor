import { useEffect } from 'react';
import {
  addNull,
  addSolid,
  arrangeSelection,
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
import i18n from '../i18n';
import { addAdjustmentLayer } from '../features/effects/effectActions';
import { groupSelection, makeCompoundFromSelection, ungroupSelection } from '../features/timeline/compoundActions';
import { saveProjectFile } from '../features/projects/projectFile';
import { useNewProjectDialog } from '../features/projects/NewProjectDialog';
import { openImportPicker } from '../features/media-bin/mediaService';
import { useExport } from '../features/export/exportService';
import { toggleFullscreen } from '../features/preview/fullscreen';
import { useSubtitlesUi } from '../features/subtitles/subtitlesUi';
import { friendlyError, showToast } from './toasts';
import { select, useTimelineUi } from '../features/timeline/timelineUi';
import { setTool, shapeToolKey, useTool } from '../features/tools/toolService';
import { stepDrawing } from '../features/paint/paintService';
import { jumpSelectedKeyframe, toggleSelectedKeyframe } from '../features/keyframes/keyframeService';
import { spaceDown } from '../features/preview/spaceHand';
import { currentProject, useProjectStore } from '../store/projectStore';
import { useTransport } from '../store/transport';
import { useShortcutSheet } from './ShortcutSheet';
import { toggleMarkerAtPlayhead } from '../features/timeline/beatActions';
import { focusSearch } from '../features/search/searchUi';

type Handler = (e: KeyboardEvent) => void;

function stepSelectedDrawing(dir: -1 | 1) {
  const sel = useTimelineUi.getState().selection;
  if (sel.length === 1) stepDrawing(sel[0], dir);
}

/** Ctrl+S: the project as a file, like Project → Save. */
export function saveProject() {
  const project = useProjectStore.getState().history?.present;
  if (!project) return;
  saveProjectFile(project, false).then(
    (missing) => missing?.length && showToast(i18n.t('projectFile.notIncluded', { count: missing.length })),
    (err) => showToast(friendlyError(err, i18n.t)),
  );
}

// Keyed by KeyboardEvent.code so letters also work with a Persian keyboard layout. After Effects'
// keys where it has one: Ctrl+Y a solid (so redo is Ctrl+Shift+Z only), Ctrl+Alt+Y an adjustment
// layer, Ctrl+Alt+Shift+Y a null, Ctrl+Shift+D split, Ctrl+Shift+C precompose (a compound clip),
// Ctrl+I import, Ctrl+M render (export). Ctrl+Alt combos are looked up as 'Alt+<code>'.
const WITH_CTRL: Record<string, Handler> = {
  KeyZ: (e) => (e.shiftKey ? useProjectStore.getState().redo() : useProjectStore.getState().undo()),
  KeyY: () => addSolid(),
  'Alt+KeyY': (e) => (e.shiftKey ? addNull() : addAdjustmentLayer()),
  KeyC: (e) => (e.shiftKey ? makeCompoundFromSelection() : copySelection()),
  KeyX: () => {
    copySelection();
    deleteSelection();
  },
  KeyV: () => paste(),
  KeyD: (e) => (e.shiftKey ? splitAtPlayhead() : duplicateSelection()),
  KeyA: selectAll,
  KeyS: saveProject,
  // Arrange (After Effects: Ctrl+] / Ctrl+[ one step, with Shift to the front / back) and group shapes.
  BracketRight: (e) => arrangeSelection(e.shiftKey ? 'bringToFront' : 'forward'),
  BracketLeft: (e) => arrangeSelection(e.shiftKey ? 'sendToBack' : 'backward'),
  KeyG: (e) => (e.shiftKey ? ungroupSelection() : groupSelection()),
  // Chrome keeps Ctrl+N for a new window; it reaches the page in the installed app.
  KeyN: () => useNewProjectDialog.setState({ open: true }),
  KeyI: () => {
    useSubtitlesUi.setState({ tab: 'media' });
    openImportPicker();
  },
  KeyM: () => currentProject() && useExport.setState({ open: true }),
  KeyK: focusSearch,
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
  // ` / ~ (the key left of 1): the preview full screen.
  Backquote: toggleFullscreen,
};

function isTypingTarget(el: EventTarget | null) {
  return el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));
}

/** App-wide keyboard shortcuts. Text fields keep their native behaviour (including their own undo). */
export function useGlobalShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const ctrl = e.ctrlKey || e.metaKey;
      // Alt alone is left to the browser; with Ctrl it picks the 'Alt+' entries.
      if (e.altKey && !ctrl) return;
      const handler = ctrl ? WITH_CTRL[e.altKey ? `Alt+${e.code}` : e.code] : PLAIN[e.code];
      if (!handler) return;
      e.preventDefault();
      handler(e);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
