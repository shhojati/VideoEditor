// Beats and markers: detect a music clip's beats, toggle markers at the playhead, cut clips to the beat.
import { showToast } from '../../app/toasts';
import i18n from '../../i18n';
import { cutToBeat, toggleMarker } from '../../model/beats';
import { findClip } from '../../model/timeline';
import type { ID } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { mediaWorker } from '../media-bin/mediaService';
import { useTimelineUi } from './timelineUi';

const project = () => useProjectStore.getState().history?.present;

/** Detect tempo and beats of a clip's asset (stored on the asset, one undo step). */
export async function detectClipBeats(clipId: ID): Promise<boolean> {
  const p = project();
  const clip = p && findClip(p, clipId)?.clip;
  const asset = clip?.assetId ? p!.assets[clip.assetId] : undefined;
  if (!asset?.fileRef.opfsPath) return false;
  const grid = await mediaWorker().beats({ opfsPath: asset.fileRef.opfsPath });
  if (!grid.times.length) return false;
  useProjectStore.getState().edit('ops.detectBeats', (d) => {
    if (d.assets[asset.id]) d.assets[asset.id].beats = grid;
  });
  return true;
}

export function clearBeats(assetId: ID) {
  useProjectStore.getState().edit('ops.detectBeats', (d) => void delete d.assets[assetId]?.beats);
}

/** M: add a marker at the playhead, or remove the one already there (within a frame). */
export function toggleMarkerAtPlayhead() {
  const p = project();
  if (!p) return;
  const t = useTransport.getState().time;
  useProjectStore.getState().edit('ops.marker', (d) => void toggleMarker(d, t, 1 / p.settings.fps));
}

export function removeMarker(id: ID) {
  useProjectStore.getState().edit('ops.marker', (d) => void (d.markers = d.markers?.filter((m) => m.id !== id)));
}

/** Re-time the selected clips to the beat (every 1, 2 or 4 beats). */
export function cutSelectionToBeat(every: number) {
  const ids = useTimelineUi.getState().selection;
  let result: ReturnType<typeof cutToBeat> | undefined;
  useProjectStore.getState().edit('ops.cutToBeat', (d) => void (result = cutToBeat(d, ids, every)));
  if (result && !result.ok) showToast(i18n.t(`beats.errors.${result.reason}`));
}
