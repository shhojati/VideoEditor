// Compound clips (make, open, leave, break apart) and marker editing.
import i18n from '../../i18n';
import { mediaTimeAt } from '../../model/remap';
import { breakApart, makeCompound, sequenceDuration } from '../../model/sequences';
import { findClip } from '../../model/timeline';
import type { ID } from '../../model/types';
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
  useProjectStore.getState().edit('ops.breakApart', (d) => void breakApart(d, clipId));
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
