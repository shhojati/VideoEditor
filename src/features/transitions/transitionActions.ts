import type React from 'react';
import { cutsOf, kindsFor, removeTransitions, setTransition } from '../../model/transitions';
import type { ID, Project, TransitionKind } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { select, useTimelineUi } from '../timeline/timelineUi';

/** Transition kind being dragged from the Transitions tab (dataTransfer is unreadable during dragover). */
export const transitionDrag: { kind: TransitionKind | null } = { kind: null };

/** Selection id for a cut that has no transition yet. */
export const cutKey = (fromId: ID, toId: ID) => `cut:${fromId}:${toId}`;

export function parseCutKey(id: string): { fromId: ID; toId: ID } | null {
  const m = /^cut:(.+):(.+)$/.exec(id);
  return m ? { fromId: m[1], toId: m[2] } : null;
}

/** Add or replace the transition on a cut; selects it. Returns false when it cannot fit. */
export function applyTransition(fromId: ID, toId: ID, kind: TransitionKind): boolean {
  let id: ID | null = null;
  useProjectStore.getState().edit('ops.addTransition', (p) => void (id = setTransition(p, fromId, toId, kind)));
  if (id) select([id]);
  return !!id;
}

export function deleteTransitions(ids: ReadonlySet<ID>) {
  useProjectStore.getState().edit('ops.removeTransition', (p) => removeTransitions(p, ids));
}

/** Cut on a track nearest to time t, within `maxDistance` seconds. */
export function nearestCut(project: Project, trackId: ID, t: number, maxDistance: number) {
  let best: ReturnType<typeof cutsOf>[number] | undefined;
  let bestD = maxDistance;
  for (const cut of cutsOf(project)) {
    if (cut.track.id !== trackId || cut.track.locked) continue;
    const d = Math.abs(cut.to.start - t);
    if (d <= bestD) {
      best = cut;
      bestD = d;
    }
  }
  return best;
}

// ---- dropping a transition card on a cut ----------------------------------------------------------

/** Pixels around a cut that count as "on the cut" while dragging. */
const DROP_PX = 28;

function cutUnderPointer(e: React.DragEvent, project: Project, trackId: ID) {
  const lane = (e.currentTarget as HTMLElement).getBoundingClientRect();
  const { pps } = useTimelineUi.getState();
  return nearestCut(project, trackId, (e.clientX - lane.left) / pps, DROP_PX / pps);
}

/** Returns true when a transition is being dragged (so the caller skips asset handling). */
export function onTransitionDragOver(e: React.DragEvent, project: Project, trackId: ID): boolean {
  if (!transitionDrag.kind) return false;
  const cut = cutUnderPointer(e, project, trackId);
  const ok = cut && kindsFor(cut.track).includes(transitionDrag.kind);
  if (ok) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }
  const key = ok ? cutKey(cut.from.id, cut.to.id) : undefined;
  if (useTimelineUi.getState().cutHover !== key) useTimelineUi.setState({ cutHover: key });
  return true;
}

export function onTransitionDrop(e: React.DragEvent, project: Project, trackId: ID): boolean {
  const kind = transitionDrag.kind;
  if (!kind) return false;
  e.preventDefault();
  const cut = cutUnderPointer(e, project, trackId);
  transitionDrag.kind = null;
  useTimelineUi.setState({ cutHover: undefined });
  if (cut) applyTransition(cut.from.id, cut.to.id, kind);
  return true;
}
