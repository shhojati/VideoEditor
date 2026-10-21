// Adding effects and filters from their panes: to the selected clips, to a clip they are dropped
// on, or — with nothing selected — as a new adjustment layer at the playhead.
import { acceptsEffects, createEffect, EFFECT_DEFS, setFilter } from '../../model/effects';
import { addAdjustmentClip, findClip } from '../../model/timeline';
import type { Clip, EffectKind, ID, Project } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { select, useTimelineUi } from '../timeline/timelineUi';

/** What a pane item does to a clip. */
export type FxItem = { type: 'effect'; kind: EffectKind } | { type: 'filter'; preset: string };

const applyTo = (clip: Clip, item: FxItem) => {
  if (item.type === 'filter') setFilter(clip, item.preset);
  else (clip.effects ??= []).push(createEffect(item.kind));
};

const project = () => useProjectStore.getState().history?.present;

/** Selected clips (unlocked) that can carry effects. */
function targets(p: Project, ids: readonly ID[]): ID[] {
  return ids.filter((id) => {
    const ref = findClip(p, id);
    return ref && !ref.track.locked && acceptsEffects(ref.clip, ref.clip.assetId ? p.assets[ref.clip.assetId]?.kind : undefined);
  });
}

export function applyFx(item: FxItem, clipIds?: readonly ID[]) {
  const p = project();
  if (!p) return;
  if (item.type === 'effect' && EFFECT_DEFS[item.kind].later) return;
  const ids = targets(p, clipIds ?? useTimelineUi.getState().selection);
  const label = item.type === 'filter' ? 'ops.addFilter' : 'ops.addEffect';
  if (ids.length) {
    useProjectStore.getState().edit(label, (d) => {
      for (const id of ids) applyTo(findClip(d, id)!.clip, item);
    });
    return;
  }
  // Nothing to apply it to: an adjustment layer at the playhead carries it over everything below.
  let id = '';
  useProjectStore.getState().edit(label, (d) => {
    id = addAdjustmentClip(d, useTransport.getState().time);
    applyTo(findClip(d, id)!.clip, item);
  });
  select([id]);
}

export function addAdjustmentLayer() {
  let id = '';
  useProjectStore.getState().edit('ops.addAdjustment', (d) => {
    id = addAdjustmentClip(d, useTransport.getState().time);
  });
  select([id]);
}

/** The pane item being dragged (dataTransfer is unreadable during dragover). */
export const fxDrag: { item: FxItem | null } = { item: null };

/** True when the dragged effect/filter could be dropped on this clip. */
export function canDropFx(p: Project, clipId: ID) {
  return !!fxDrag.item && targets(p, [clipId]).length > 0;
}
