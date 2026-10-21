// Timeline commands shared by the toolbar and keyboard shortcuts. Each project change is one undo step.
import {
  addShapeClip,
  addTextClip,
  copyClips,
  deleteClips,
  editPoints,
  findClip,
  pasteClips,
  splitClips,
  timelineDuration,
  type ClipboardItem,
} from '../../model/timeline';
import { defaultShape } from '../../model/overlays';
import type { ID, Project, ShapeKind } from '../../model/types';
import { detectRtl } from '../../engine/render/textLayout';
import { deleteCues, findCue, splitCue } from '../../model/subtitles';
import { findTransition, removeTransitions } from '../../model/transitions';
import { useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { clampPps, select, useTimelineUi } from './timelineUi';

const project = () => useProjectStore.getState().history?.present;
const edit = (...args: Parameters<ReturnType<typeof useProjectStore.getState>['edit']>) =>
  useProjectStore.getState().edit(...args);

/** Selected clips that are on unlocked tracks and still exist. */
export function editableSelection(p: Project): Set<ID> {
  return new Set(useTimelineUi.getState().selection.filter((id) => findClip(p, id) && !findClip(p, id)!.track.locked));
}

/** New text clip at the playhead, selected so the inspector opens on it. */
export function addText(content: string) {
  let id = '';
  edit('ops.addText', (d) => {
    id = addTextClip(d, useTransport.getState().time, {
      content,
      fontFamily: 'Vazirmatn',
      fontSize: 72,
      fontWeight: 700,
      color: '#ffffff',
      strokeColor: '#000000',
      strokeWidth: 6,
      align: 'center',
      rtl: detectRtl(content),
      fadeIn: 0,
      fadeOut: 0,
    });
  });
  select([id]);
}

export function splitAtPlayhead() {
  const p = project();
  if (!p) return;
  const time = useTransport.getState().time;
  // Selected subtitle cues under the playhead split instead of clips.
  const cues = useTimelineUi.getState().selection.filter((id) => {
    const c = findCue(p, id)?.cue;
    return c && time > c.start && time < c.end;
  });
  if (cues.length) {
    edit('ops.splitCue', (d) => cues.forEach((id) => splitCue(d, id, time)));
    return;
  }
  const sel = editableSelection(p);
  edit('ops.split', (d) => void splitClips(d, time, sel.size ? sel : undefined));
}

export function deleteSelection(ripple = false) {
  const p = project();
  if (!p) return;
  const sel = editableSelection(p);
  const cues = new Set(useTimelineUi.getState().selection.filter((id) => findCue(p, id)));
  const transitions = new Set(useTimelineUi.getState().selection.filter((id) => findTransition(p, id)));
  if (!sel.size && !cues.size && !transitions.size) return;
  edit(ripple ? 'ops.rippleDelete' : 'ops.deleteClips', (d) => {
    deleteClips(d, sel, ripple);
    deleteCues(d, cues);
    removeTransitions(d, transitions);
  });
  select([]);
}

let clipboard: ClipboardItem[] = [];

export function copySelection() {
  const p = project();
  if (p) clipboard = copyClips(p, new Set(useTimelineUi.getState().selection));
}

export function paste(at = useTransport.getState().time) {
  if (!clipboard.length) return;
  let ids: ID[] = [];
  edit('ops.paste', (d) => void (ids = pasteClips(d, clipboard, at)));
  select(ids);
}

/** Copy + paste right after the end of the selection. */
export function duplicateSelection() {
  const p = project();
  if (!p) return;
  const sel = useTimelineUi.getState().selection.map((id) => findClip(p, id)).filter((r) => !!r);
  if (!sel.length) return;
  copySelection();
  paste(Math.max(...sel.map((r) => r.clip.start + r.clip.duration)));
}

export function selectAll() {
  const p = project();
  if (p) select(p.tracks.filter((t) => !t.locked).flatMap((t) => t.clips.map((c) => c.id)));
}

export function stepFrames(frames: number) {
  const p = project();
  if (!p) return;
  const { time, seek } = useTransport.getState();
  // Land exactly on frame boundaries.
  seek(Math.round(time * p.settings.fps + frames) / p.settings.fps);
}

export function jumpToEdit(direction: 1 | -1) {
  const p = project();
  if (!p) return;
  const { time, seek } = useTransport.getState();
  const pts = editPoints(p);
  const target = direction > 0 ? pts.find((t) => t > time + 1e-6) : [...pts].reverse().find((t) => t < time - 1e-6);
  if (target !== undefined) seek(target);
}

export function seekToEnd() {
  const p = project();
  if (p) useTransport.getState().seek(timelineDuration(p));
}

/** Zoom keeping the time under `anchorX` (px from the lane origin, i.e. after the header) fixed. */
export function zoomBy(factor: number, anchorX?: number) {
  const { pps, scrollX, viewportWidth, headerWidth } = useTimelineUi.getState();
  const x = anchorX ?? (viewportWidth - headerWidth) / 2;
  const anchorTime = (scrollX + x) / pps;
  const next = clampPps(pps * factor);
  useTimelineUi.setState({ pps: next, scrollX: Math.max(0, anchorTime * next - x) });
}

export function zoomToFit() {
  const p = project();
  const { viewportWidth, headerWidth } = useTimelineUi.getState();
  const d = p ? timelineDuration(p) : 0;
  if (d <= 0) return;
  useTimelineUi.setState({ pps: clampPps(((viewportWidth - headerWidth) * 0.95) / d), scrollX: 0 });
}

/** New shape clip at the playhead, selected so the inspector and canvas handles open on it. */
export function addShape(kind: ShapeKind) {
  let id = '';
  edit('ops.addShape', (d) => {
    id = addShapeClip(d, useTransport.getState().time, defaultShape(kind));
  });
  select([id]);
}
