// Pointer-driven editing. During a gesture only a preview (timelineUi.drag) changes; the project is
// edited once on release, so every gesture is a single undo step.
import type { DragEvent, PointerEvent as ReactPointerEvent } from 'react';
import {
  canMove,
  clamp,
  createClip,
  cueBoundaries,
  editPoints,
  findClip,
  insertClip,
  isFree,
  moveClips,
  nearestFreeStart,
  trackAccepts,
  trackKindFor,
  trimClip,
  trimLimits,
  type ClipMove,
} from '../../model/timeline';
import { createTrack } from '../../model/factories';
import type { ID, Project } from '../../model/types';
import { blurTextFields } from '../../lib/focus';
import { useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { snapBlock, snapTime } from './snapping';
import { timelineBeats } from '../../model/beats';
import { assetDrag, select, SNAP_PX, useTimelineUi, type DragPreview } from './timelineUi';

const DRAG_THRESHOLD_PX = 3;
const project = () => useProjectStore.getState().history!.present;

function snapPoints(p: Project, exclude: ReadonlySet<ID>) {
  // Beats of the clips being dragged move with them, so they are not targets.
  return [
    ...editPoints(p, exclude),
    useTransport.getState().time,
    ...cueBoundaries(p),
    ...(p.markers ?? []).map((m) => m.t),
    ...timelineBeats(p, exclude),
  ];
}

const snapThreshold = (altKey: boolean) => {
  const { snapping, pps } = useTimelineUi.getState();
  return snapping && !altKey ? SNAP_PX / pps : 0;
};

/** Track id under the pointer, from the lane elements (top-to-bottom display order). */
function laneAt(clientX: number, clientY: number): ID | null | undefined {
  const lane = document.elementFromPoint(clientX, clientY)?.closest<HTMLElement>('[data-lane]');
  if (!lane) return undefined;
  return lane.dataset.trackId || null; // '' = the "new track" drop zone
}

/** Displayed order of tracks: top first (the model stores bottom -> top). */
const displayOrder = (p: Project) => [...p.tracks].reverse().map((t) => t.id);

export function beginClipDrag(e: ReactPointerEvent, clipId: ID, mode: 'move' | 'trim-start' | 'trim-end') {
  if (e.button !== 0) return;
  e.preventDefault();
  blurTextFields();
  const p = project();
  const ref = findClip(p, clipId);
  if (!ref || ref.track.locked) return;

  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  const { selection } = useTimelineUi.getState();
  if (additive) select([clipId], 'toggle');
  else if (!selection.includes(clipId) || mode !== 'move') select([clipId]);

  const startX = e.clientX;
  const startY = e.clientY;
  let moved = false;
  let preview: DragPreview | null = null;

  const onMove = (ev: PointerEvent) => {
    if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < DRAG_THRESHOLD_PX) return;
    moved = true;
    const dt = (ev.clientX - startX) / useTimelineUi.getState().pps;
    preview = mode === 'move' ? movePreview(p, clipId, dt, ev) : trimPreview(p, clipId, mode, dt, ev.altKey);
    useTimelineUi.setState({ drag: preview });
  };

  const finish = (commit: boolean) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey);
    useTimelineUi.setState({ drag: null });
    if (!commit || !moved || !preview) return;
    const { edit } = useProjectStore.getState();
    if (mode === 'move') {
      const moves = previewToMoves(preview);
      if (preview.valid) edit('ops.moveClips', (d) => void moveClips(d, moves));
      else if (moves.length === 1) {
        // A single clip dropped onto an occupied spot lands in the nearest free one.
        edit('ops.moveClips', (d) => {
          const target = d.tracks.find((t) => t.id === moves[0].trackId)!;
          const dur = findClip(d, clipId)!.clip.duration;
          moves[0].start = nearestFreeStart(target, moves[0].start, dur, new Set([clipId]));
          moveClips(d, moves);
        });
      }
    } else {
      const c = preview.clips[clipId];
      const time = mode === 'trim-start' ? c.start : c.start + c.duration;
      edit('ops.trimClip', (d) => void trimClip(d, clipId, mode === 'trim-start' ? 'start' : 'end', time));
    }
  };
  const onUp = () => finish(true);
  const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && finish(false);
  // Touch: the browser took the gesture over (a pan on an unselected clip).
  const onCancel = () => finish(false);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey);
}

function previewToMoves(preview: DragPreview): ClipMove[] {
  return Object.entries(preview.clips).map(([clipId, c]) => ({ clipId, trackId: c.trackId, start: c.start }));
}

function movePreview(p: Project, clipId: ID, dt: number, ev: PointerEvent): DragPreview {
  const ids = useTimelineUi.getState().selection.filter((id) => {
    const r = findClip(p, id);
    return r && !r.track.locked;
  });
  if (!ids.includes(clipId)) ids.push(clipId);
  const refs = ids.map((id) => findClip(p, id)!);

  // Vertical: shift every clip by the same number of tracks, if all land on compatible tracks.
  const order = displayOrder(p);
  const hovered = laneAt(ev.clientX, ev.clientY);
  let trackShift = 0;
  if (hovered) {
    const shift = order.indexOf(hovered) - order.indexOf(findClip(p, clipId)!.track.id);
    const ok = refs.every((r) => {
      const t = p.tracks.find((x) => x.id === order[order.indexOf(r.track.id) + shift]);
      return t && t.kind === r.track.kind && !t.locked;
    });
    if (ok) trackShift = shift;
  }

  // Horizontal: snap the selection as one block.
  const minStart = Math.min(...refs.map((r) => r.clip.start));
  const maxEnd = Math.max(...refs.map((r) => r.clip.start + r.clip.duration));
  let delta = Math.max(dt, -minStart);
  const snap = snapBlock(minStart + delta, maxEnd - minStart, snapPoints(p, new Set(ids)), snapThreshold(ev.altKey));
  delta = Math.max(snap.time - minStart, -minStart);

  const clips: DragPreview['clips'] = {};
  for (const r of refs) {
    clips[r.clip.id] = {
      trackId: order[order.indexOf(r.track.id) + trackShift],
      start: r.clip.start + delta,
      duration: r.clip.duration,
    };
  }
  const preview: DragPreview = { clips, valid: true, guide: snap.target };
  preview.valid = canMove(p, previewToMoves(preview));
  return preview;
}

function trimPreview(p: Project, clipId: ID, mode: 'trim-start' | 'trim-end', dt: number, altKey: boolean): DragPreview {
  const { clip, track } = findClip(p, clipId)!;
  const edge = mode === 'trim-start' ? 'start' : 'end';
  const original = edge === 'start' ? clip.start : clip.start + clip.duration;
  const snap = snapTime(original + dt, snapPoints(p, new Set([clipId])), snapThreshold(altKey));
  const t = clamp(snap.time, trimLimits(p, clipId, edge));
  const guide = snap.target !== undefined && Math.abs(t - snap.target) < 1e-6 ? snap.target : undefined;
  const end = clip.start + clip.duration;
  const c = edge === 'start' ? { start: t, duration: end - t } : { start: clip.start, duration: t - clip.start };
  return { clips: { [clipId]: { trackId: track.id, ...c } }, valid: true, guide };
}

// ---- dropping assets from the media bin ---------------------------------------------------------

function assetDropPreview(e: DragEvent, trackId: ID | null): DragPreview | null {
  const assetId = assetDrag.assetId;
  const p = project();
  const asset = assetId ? p.assets[assetId] : undefined;
  if (!asset) return null;
  const lane = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const { pps } = useTimelineUi.getState();
  const proto = createClip(asset, 0);
  const raw = Math.max(0, (e.clientX - lane.left) / pps);
  const snap = snapBlock(raw, proto.duration, snapPoints(p, new Set()), snapThreshold(e.altKey));
  let start = Math.max(0, snap.time);

  const track = trackId ? p.tracks.find((t) => t.id === trackId) : undefined;
  let target: ID | null = null;
  if (track && !track.locked && trackAccepts(track, asset.kind)) {
    target = track.id;
    if (!isFree(track, start, proto.duration)) start = nearestFreeStart(track, start, proto.duration);
  }
  return { clips: {}, asset: { assetId: asset.id, trackId: target, start, duration: proto.duration }, valid: true, guide: snap.target };
}

export function onLaneDragOver(e: DragEvent, trackId: ID | null) {
  if (!assetDrag.assetId) {
    if (assetDrag.pending) e.preventDefault(); // accept the drop; the clip is placed once downloaded
    return;
  }
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
  const preview = assetDropPreview(e, trackId);
  if (preview) useTimelineUi.setState({ drag: preview });
}

export function onLaneDragLeave(e: DragEvent) {
  if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) useTimelineUi.setState({ drag: null });
}

export function onLaneDrop(e: DragEvent, trackId: ID | null) {
  if (!assetDrag.assetId) {
    if (!assetDrag.pending) return;
    e.preventDefault();
    const lane = (e.currentTarget as HTMLElement).getBoundingClientRect();
    assetDrag.pending(trackId, Math.max(0, (e.clientX - lane.left) / useTimelineUi.getState().pps));
    assetDrag.pending = null;
    return;
  }
  e.preventDefault();
  const preview = assetDropPreview(e, trackId);
  useTimelineUi.setState({ drag: null });
  assetDrag.assetId = null;
  if (!preview?.asset) return;
  const { assetId, trackId: target, start } = preview.asset;
  addAssetClip(assetId, target, start);
}

/**
 * Tap-to-add (touch screens have no drag and drop): at the playhead, on the topmost unlocked track
 * that takes the asset and has room there, else on a new track.
 */
export function addAssetAtPlayhead(assetId: ID) {
  const p = project();
  const asset = p.assets[assetId];
  if (!asset) return;
  const start = useTransport.getState().time;
  const duration = createClip(asset, start).duration;
  const target = [...p.tracks]
    .reverse()
    .find((t) => !t.locked && trackAccepts(t, asset.kind) && isFree(t, start, duration));
  addAssetClip(assetId, target?.id ?? null, start);
}

/**
 * Place an asset that was dropped before it was ready: on `trackId` if that track takes it (at the
 * nearest free spot), otherwise on a new track.
 */
export function placeAssetAt(assetId: ID, trackId: ID | null, time: number) {
  const p = project();
  const asset = p.assets[assetId];
  if (!asset) return;
  const track = trackId ? p.tracks.find((t) => t.id === trackId) : undefined;
  if (track && !track.locked && trackAccepts(track, asset.kind))
    addAssetClip(assetId, track.id, nearestFreeStart(track, time, createClip(asset, time).duration));
  else addAssetClip(assetId, null, time);
}

/** One undo step: a clip of the asset at `start`, on `target` or (null) a new track. */
function addAssetClip(assetId: ID, target: ID | null, start: number) {
  let clipId = '';
  useProjectStore.getState().edit('ops.addClip', (d) => {
    const asset = d.assets[assetId];
    let track = target ? d.tracks.find((t) => t.id === target) : undefined;
    if (!track) {
      track = createTrack(trackKindFor(asset.kind));
      // New video tracks go on top of the stack; new audio tracks at the bottom, under the video.
      if (track.kind === 'audio') d.tracks.unshift(track);
      else d.tracks.push(track);
    }
    const clip = createClip(asset, start);
    clipId = clip.id;
    insertClip(track, clip);
  });
  select([clipId]);
}
