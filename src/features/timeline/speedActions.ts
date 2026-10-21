// Speed tools: reverse (via a reversed copy of the media), freeze frames, ramps.
import { create } from 'zustand';
import { sourceLength } from '../../model/remap';
import { flipToMedia, freezeFrame, MAX_REVERSE_SECONDS } from '../../model/speed';
import { findClip } from '../../model/timeline';
import type { ID } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { importFileAs, mediaWorker } from '../media-bin/mediaService';
import { select } from './timelineUi';

export type ReverseError = 'tooLong' | 'missing' | 'failed';

export const useSpeedUi = create<{ reversing: ID | null; error?: { clipId: ID; reason: ReverseError } }>()(() => ({ reversing: null }));

const project = () => useProjectStore.getState().history?.present;
/** Extra source kept on each side of a reversed range, for later trims and transitions (s). */
const HANDLE = 2;

/**
 * Reverse a clip, or play it forwards again. The first time, a reversed copy of the media (all of
 * it when short, else the clip's range plus handles) is made and imported; a copy that already
 * covers the range is reused.
 */
export async function toggleReverse(clipId: ID): Promise<void> {
  const p = project();
  const clip = p && findClip(p, clipId)?.clip;
  const asset = clip?.assetId ? p!.assets[clip.assetId] : undefined;
  if (!p || !clip || !asset?.fileRef.opfsPath || useSpeedUi.getState().reversing) return;
  const fail = (reason: ReverseError) => useSpeedUi.setState({ reversing: null, error: { clipId, reason } });
  useSpeedUi.setState({ error: undefined });

  if (asset.reverseOf) {
    const original = p.assets[asset.reverseOf.assetId];
    if (!original) return fail('missing');
    const { to } = asset.reverseOf;
    useProjectStore.getState().edit('ops.reverse', (d) => {
      const c = findClip(d, clipId)?.clip;
      if (c) flipToMedia(d, c, original.id, to);
    });
    return;
  }

  const duration = asset.duration ?? clip.inPoint + sourceLength(clip);
  const whole = duration <= MAX_REVERSE_SECONDS;
  const from = whole ? 0 : Math.max(0, clip.inPoint - HANDLE);
  const to = whole ? duration : Math.min(duration, clip.inPoint + sourceLength(clip) + HANDLE);
  if (to - from > MAX_REVERSE_SECONDS) return fail('tooLong');

  let copy = Object.values(p.assets).find((a) => a.reverseOf?.assetId === asset.id && a.reverseOf.from <= from + 1e-3 && a.reverseOf.to >= to - 1e-3);
  if (!copy) {
    useSpeedUi.setState({ reversing: clipId });
    try {
      const { blob, ext } = await mediaWorker().reverse({ opfsPath: asset.fileRef.opfsPath, from, to });
      const name = `${asset.name.replace(/\.[^.]+$/, '')} (reversed).${ext}`;
      const id = await importFileAs(new File([blob], name, { type: blob.type }), { reverseOf: { assetId: asset.id, from, to } });
      copy = id ? project()?.assets[id] : undefined;
    } catch (e) {
      console.warn('reverse failed', e);
    }
    if (!copy) return fail('failed');
  }
  const { id: copyId, reverseOf } = copy;
  useProjectStore.getState().edit('ops.reverse', (d) => {
    const c = findClip(d, clipId)?.clip;
    if (c) flipToMedia(d, c, copyId, reverseOf!.to);
  });
  useSpeedUi.setState({ reversing: null });
}

/** Freeze the frame at the playhead (inside the clip) for a couple of seconds. */
export function freezeAtPlayhead(clipId: ID) {
  const t = useTransport.getState().time;
  let still: ID | null = null;
  useProjectStore.getState().edit('ops.freeze', (d) => void (still = freezeFrame(d, clipId, t)));
  if (still) select([still]);
}
