// Timeline commands shared by the toolbar and keyboard shortcuts. Each project change is one undo step.
import {
  addNullClip,
  addShapeClip,
  addSolidClip,
  addTextClip,
  copyClips,
  deleteClips,
  detachAudio,
  editPoints,
  findClip,
  pasteClips,
  splitClips,
  timelineDuration,
  type ClipboardItem,
} from '../../model/timeline';
import { defaultShape, TEXT_STYLE_DEFAULTS } from '../../model/overlays';
import type { ID, MaskVertex, Project, ShapeKind } from '../../model/types';
import { pathBounds } from '../../model/masks';
import { unparent } from './parentActions';
import { detectRtl } from '../../engine/render/textLayout';
import { deleteCues, findCue, splitCue } from '../../model/subtitles';
import { findTransition, removeTransitions } from '../../model/transitions';
import { currentProject, useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { clampPps, select, useTimelineUi } from './timelineUi';

const project = () => currentProject() ?? undefined;
const edit = (...args: Parameters<ReturnType<typeof useProjectStore.getState>['edit']>) =>
  useProjectStore.getState().edit(...args);

/** Selected clips that are on unlocked tracks and still exist. */
export function editableSelection(p: Project): Set<ID> {
  return new Set(useTimelineUi.getState().selection.filter((id) => findClip(p, id) && !findClip(p, id)!.track.locked));
}

/** Where a clip drawn on the preview goes: centre (project px), size and rotation (degrees). */
export interface Placement {
  cx: number;
  cy: number;
  w?: number;
  h?: number;
  rotation?: number;
}

/** Centre the clip on the placement (its transform position is relative to the frame centre). */
function place(p: Project, id: ID, at: Placement) {
  const clip = findClip(p, id)?.clip;
  if (!clip) return;
  const { width: W, height: H } = p.settings;
  clip.transform.x = (at.cx - W / 2) / W;
  clip.transform.y = (at.cy - H / 2) / H;
  if (at.rotation) clip.transform.rotation = at.rotation;
}

/**
 * New text clip at the playhead (at `at` on the preview when given), selected so the inspector
 * opens on it. `mergeKey`: the typing that follows joins the same undo step.
 */
export function addText(content: string, at?: Placement, mergeKey?: string): ID {
  let id = '';
  edit(
    'ops.addText',
    (d) => {
      id = addTextClip(d, useTransport.getState().time, { ...TEXT_STYLE_DEFAULTS, content, rtl: detectRtl(content) });
      if (at) place(d, id, at);
    },
    mergeKey ? { mergeKey, gesture: true } : undefined,
  );
  select([id]);
  return id;
}

/** Selected video clips that still play their own sound (what "Detach audio" can work on). */
export function detachableClips(p: Project, selection: readonly ID[]): ID[] {
  return selection.filter((id) => {
    const ref = findClip(p, id);
    const asset = ref?.clip.assetId ? p.assets[ref.clip.assetId] : undefined;
    return !!ref && ref.track.kind !== 'audio' && !ref.track.locked && asset?.kind === 'video' && !!asset.hasAudio && !ref.clip.audioDetached && !ref.clip.freeze;
  });
}

/** The selected video clips' sound onto their own audio clips; the new audio clips are selected. */
export function detachSelectedAudio() {
  const p = project();
  if (!p) return;
  const ids = detachableClips(p, useTimelineUi.getState().selection);
  if (!ids.length) return;
  let created: ID[] = [];
  edit('ops.detachAudio', (d) => void (created = detachAudio(d, ids)));
  if (created.length) select(created);
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
  const now = useTransport.getState().time;
  edit(ripple ? 'ops.rippleDelete' : 'ops.deleteClips', (d) => {
    // Children of a deleted parent stay where they are drawn now.
    for (const t of d.tracks) for (const c of t.clips) if (c.parentId && sel.has(c.parentId) && !sel.has(c.id)) unparent(d, c, now);
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

/**
 * New shape clip at the playhead, selected so the inspector and canvas handles open on it. Drawn
 * with the shape tool it takes the dragged box (`at`).
 */
export function addShape(kind: ShapeKind, at?: Placement) {
  let id = '';
  edit('ops.addShape', (d) => {
    const shape = defaultShape(kind);
    if (at?.w) shape.width = Math.round(at.w);
    if (at?.h && kind !== 'line') shape.height = Math.round(at.h);
    id = addShapeClip(d, useTransport.getState().time, shape);
    if (at) place(d, id, at);
  });
  select([id]);
}

/**
 * New shape from a path drawn with the pen (points in project pixels around the frame centre):
 * centred on its own middle, filled when closed, a white line when open. Selected.
 */
export function addPathShape(path: MaskVertex[], closed: boolean) {
  const b = pathBounds(path);
  const mx = b.x + b.width / 2;
  const my = b.y + b.height / 2;
  let id = '';
  edit('ops.addShape', (d) => {
    const shape = {
      ...defaultShape('path'),
      kind: 'path' as const,
      width: Math.max(4, Math.round(b.width)),
      height: Math.max(4, Math.round(b.height)),
      path: { value: path.map(([x, y, ix, iy, ox, oy]): MaskVertex => [x - mx, y - my, ix, iy, ox, oy]) },
      closed,
      ...(closed ? { fill: '#2563eb', strokeWidth: 0 } : { fill: undefined, stroke: '#ffffff', strokeWidth: 8 }),
    };
    id = addShapeClip(d, useTransport.getState().time, shape);
    place(d, id, { cx: d.settings.width / 2 + mx, cy: d.settings.height / 2 + my });
  });
  select([id]);
}

/** A solid colour layer (full frame) at the playhead, selected. */
export function addSolid(color = '#6b7280') {
  let id = '';
  edit('ops.addSolid', (d) => void (id = addSolidClip(d, useTransport.getState().time, color)));
  select([id]);
}

/** A null object (invisible, a parent for other clips) at the playhead, selected. */
export function addNull() {
  let id = '';
  edit('ops.addNull', (d) => void (id = addNullClip(d, useTransport.getState().time)));
  select([id]);
}
