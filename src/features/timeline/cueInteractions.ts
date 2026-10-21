// Moving and trimming subtitle cues on the timeline. Same pattern as clip gestures: only a preview
// changes while dragging, the project is edited once on release.
import type { PointerEvent as ReactPointerEvent } from 'react';
import { canShiftCues, cueEdgeLimits, findCue, setCueEdge, shiftCues } from '../../model/subtitles';
import { editPoints } from '../../model/timeline';
import { timelineBeats } from '../../model/beats';
import type { ID, Project } from '../../model/types';
import { blurTextFields } from '../../lib/focus';
import { currentProject, useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { snapBlock, snapTime } from './snapping';
import { select, SNAP_PX, useTimelineUi, type DragPreview } from './timelineUi';

const project = () => currentProject()!;

function snapPoints(p: Project, excludeCues: ReadonlySet<ID>) {
  const cuePts = p.subtitleTracks.flatMap((st) => st.cues.filter((c) => !excludeCues.has(c.id)).flatMap((c) => [c.start, c.end]));
  return [...editPoints(p), useTransport.getState().time, ...cuePts, ...(p.markers ?? []).map((m) => m.t), ...timelineBeats(p)];
}

export function beginCueDrag(e: ReactPointerEvent, cueId: ID, mode: 'move' | 'trim-start' | 'trim-end') {
  if (e.button !== 0) return;
  e.preventDefault();
  blurTextFields();
  const p = project();
  const ref = findCue(p, cueId);
  if (!ref) return;
  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  const { selection } = useTimelineUi.getState();
  if (additive) select([cueId], 'toggle');
  else if (!selection.includes(cueId) || mode !== 'move') select([cueId]);

  // Moving: every selected cue on the same track goes along.
  const ids = new Set(
    mode === 'move'
      ? useTimelineUi.getState().selection.filter((id) => ref.track.cues.some((c) => c.id === id)).concat(cueId)
      : [cueId],
  );
  const moving = ref.track.cues.filter((c) => ids.has(c.id));
  const startX = e.clientX;
  let preview: DragPreview | null = null;
  let moved = false;

  const onMove = (ev: PointerEvent) => {
    if (!moved && Math.abs(ev.clientX - startX) < 3) return;
    moved = true;
    const { pps, snapping } = useTimelineUi.getState();
    const dt = (ev.clientX - startX) / pps;
    const threshold = snapping && !ev.altKey ? SNAP_PX / pps : 0;
    const points = snapPoints(p, ids);
    if (mode === 'move') {
      const first = Math.min(...moving.map((c) => c.start));
      const last = Math.max(...moving.map((c) => c.end));
      const snap = snapBlock(Math.max(0, first + dt), last - first, points, threshold);
      const delta = Math.max(-first, snap.time - first);
      preview = {
        clips: {},
        cues: Object.fromEntries(moving.map((c) => [c.id, { start: c.start + delta, end: c.end + delta }])),
        valid: canShiftCues(ref.track, ids, delta),
        guide: snap.target,
      };
    } else {
      const edge = mode === 'trim-start' ? 'start' : 'end';
      const limits = cueEdgeLimits(ref.track, ref.index, edge);
      const snap = snapTime(ref.cue[edge] + dt, points, threshold);
      const t = Math.min(limits.max, Math.max(limits.min, snap.time));
      preview = {
        clips: {},
        cues: { [cueId]: { start: edge === 'start' ? t : ref.cue.start, end: edge === 'end' ? t : ref.cue.end } },
        valid: true,
        guide: snap.target === t ? t : undefined,
      };
    }
    useTimelineUi.setState({ drag: preview });
  };

  const finish = (commit: boolean) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey);
    useTimelineUi.setState({ drag: null });
    if (!commit || !moved || !preview?.valid || !preview.cues) return;
    const { edit } = useProjectStore.getState();
    const after = preview.cues[cueId];
    if (mode === 'move') {
      const delta = after.start - ref.cue.start;
      edit('ops.moveCues', (d) => void shiftCues(d, ids, delta));
    } else {
      const edge = mode === 'trim-start' ? 'start' : 'end';
      edit('ops.trimCue', (d) => void setCueEdge(d, cueId, edge, after[edge]));
    }
  };
  const onUp = () => finish(true);
  const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && finish(false);
  // Touch: the browser took the gesture over (a pan on an unselected cue).
  const onCancel = () => finish(false);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey);
}
