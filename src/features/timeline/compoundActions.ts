// Compound clips (make, open, leave, break apart) and marker editing.
import i18n from '../../i18n';
import { mediaTimeAt } from '../../model/remap';
import { breakApart, makeCompound, sequenceDuration } from '../../model/sequences';
import { findClip } from '../../model/timeline';
import type { ID, Project } from '../../model/types';
import { showToast } from '../../app/toasts';
import { drawnClip } from '../../engine/render/parenting';
import { clipBox, corners } from '../preview/canvasGeometry';
import { currentProject, rootProject, useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { select, useTimelineUi } from './timelineUi';

/** Turn the selected clips into one compound clip (one undo step). */
export function makeCompoundFromSelection() {
  const ids = useTimelineUi.getState().selection;
  const n = Object.keys(rootProject()?.sequences ?? {}).length + 1;
  let id: ID | null = null;
  useProjectStore.getState().edit('ops.makeCompound', (d) => void (id = makeCompound(d, ids, i18n.t('compound.name', { n }))));
  if (id) select([id]);
}

/** Open a compound clip: the timeline and preview show its insides, at the matching time. */
export function enterCompound(clipId: ID) {
  const p = currentProject();
  const clip = p && findClip(p, clipId)?.clip;
  if (!p || !clip?.sequenceId) return;
  const time = useTransport.getState().time;
  const inside = Math.min(Math.max(0, mediaTimeAt(clip, Math.min(Math.max(time, clip.start), clip.start + clip.duration))), sequenceDuration(p, clip.sequenceId));
  useProjectStore.setState((s) => ({ editPath: [...s.editPath, { clipId, sequenceId: clip.sequenceId!, outerTime: time }] }));
  select([]);
  useTransport.getState().seek(inside);
}

/** Go back out to `level` (0 = the main timeline), where the playhead was before. */
export function exitTo(level: number) {
  const path = useProjectStore.getState().editPath;
  if (level >= path.length) return;
  const left = path[level];
  useProjectStore.setState({ editPath: path.slice(0, level) });
  select([left.clipId]);
  useTransport.getState().seek(left.outerTime);
}

export function breakApartClip(clipId: ID) {
  let done = false as ReturnType<typeof breakApart>;
  useProjectStore.getState().edit('ops.breakApart', (d) => void (done = breakApart(d, clipId)));
  if (done === 'approx') showToast(i18n.t('compound.breakApprox'));
  select([]);
}

let measureCtx: CanvasRenderingContext2D | null = null;
const measure = () => (measureCtx ??= document.createElement('canvas').getContext('2d')!);

/**
 * Where a group of clips pivots: the middle of their boxes on the canvas (project px, at timeline
 * time t), or undefined when they have no box or are larger than the frame.
 */
export function groupPivot(p: Project, ids: readonly ID[], t: number): { x: number; y: number } | undefined {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const id of ids) {
    const clip = findClip(p, id)?.clip;
    if (!clip) continue;
    const at = Math.min(Math.max(t, clip.start), clip.start + clip.duration);
    const box = clipBox(p, drawnClip(p, clip, at), measure(), at);
    if (!box) continue;
    for (const c of corners(box)) {
      x0 = Math.min(x0, c.x);
      y0 = Math.min(y0, c.y);
      x1 = Math.max(x1, c.x);
      y1 = Math.max(y1, c.y);
    }
  }
  if (!(x1 > x0) || x1 - x0 > p.settings.width || y1 - y0 > p.settings.height) return undefined;
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

/** Group the selected clips (Ctrl+G): a compound clip that scales and turns about its content. */
export function groupSelection() {
  const ids = useTimelineUi.getState().selection;
  const n = Object.keys(rootProject()?.sequences ?? {}).length + 1;
  const t = useTransport.getState().time;
  let id: ID | null = null;
  useProjectStore.getState().edit('ops.group', (d) => void (id = makeCompound(d, ids, i18n.t('compound.groupName', { n }), { pivot: groupPivot(d, ids, t) })));
  if (id) select([id]);
}

/** Ungroup (Ctrl+Shift+G): break apart the selected compound clips. */
export function ungroupSelection() {
  const ids = useTimelineUi.getState().selection;
  let approx = false;
  useProjectStore.getState().edit('ops.breakApart', (d) => {
    for (const id of ids) if (breakApart(d, id) === 'approx') approx = true;
  });
  if (approx) showToast(i18n.t('compound.breakApprox'));
  select([]);
}

export function renameCompound(sequenceId: ID, name: string) {
  useProjectStore.getState().edit(
    'ops.renameCompound',
    (d) => {
      const seq = d.sequences?.[sequenceId];
      if (seq) seq.name = name;
    },
    { mergeKey: `compound-name:${sequenceId}` },
  );
}

// ---- markers ---------------------------------------------------------------------------------------

export const MARKER_COLORS = ['#facc15', '#ef4444', '#22c55e', '#3b82f6', '#a855f7'];

export function editMarker(id: ID, patch: { label?: string; color?: string }) {
  useProjectStore.getState().edit(
    'ops.marker',
    (d) => {
      const m = d.markers?.find((x) => x.id === id);
      if (!m) return;
      if (patch.label !== undefined) {
        if (patch.label) m.label = patch.label;
        else delete m.label;
      }
      if (patch.color) m.color = patch.color;
    },
    { mergeKey: `marker:${id}:${patch.label !== undefined ? 'label' : 'color'}` },
  );
}
