// Parenting (After Effects' Parent & Link): attaching a clip to a parent, or detaching it, keeps it
// where it is drawn at the playhead. Its transform and its transform keyframes are converted with
// the parent's pose at that moment, as After Effects does.
import { parentPose, toLocal, toWorld, wouldCycle, type Pose } from '../../engine/render/parenting';
import { keyedClip } from '../../model/keyframes';
import { isOverlay } from '../../model/overlays';
import { keyToTimeline } from '../../model/remap';
import { findClip } from '../../model/timeline';
import type { Clip, ID, Project, Transform } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';

const TRANSFORM_KEYS = ['x', 'y', 'rotation', 'scale'] as const;

/** Convert the clip's transform and its transform keyframes with `fn` (world ↔ local). */
function convert(clip: Clip, fn: (tr: Transform) => Transform) {
  // Every keyframe's full transform (missing values filled in) from the clip as it was, then written.
  const keys = (clip.keyframes ?? []).map((k) => ({ k, tr: fn(keyedClip(clip, keyToTimeline(clip, k.t)).transform) }));
  for (const { k, tr } of keys) for (const p of TRANSFORM_KEYS) if (p in k.v) k.v[p] = tr[p];
  clip.transform = fn(clip.transform);
}

/** Detach a clip from its parent, keeping it where it is drawn at timeline time t. */
export function unparent(p: Project, clip: Clip, t: number) {
  const pose = parentPose(p, clip, t);
  delete clip.parentId;
  if (pose) convert(clip, (tr) => toWorld(p, tr, pose));
}

function attach(p: Project, clip: Clip, parentId: ID, t: number) {
  clip.parentId = parentId;
  const pose: Pose | undefined = parentPose(p, clip, t);
  if (pose) convert(clip, (tr) => toLocal(p, tr, pose));
}

/** Clips that can be the parent of `clip`: other visual clips that would not make a loop. */
export function parentCandidates(p: Project, clip: Clip): Clip[] {
  return p.tracks.flatMap((track) =>
    track.kind === 'audio'
      ? []
      : track.clips.filter((c) => c.id !== clip.id && !wouldCycle(p, clip.id, c.id) && (isOverlay(c) || !!c.assetId || !!c.sequenceId)),
  );
}

/** Set (or with null, clear) the clip's parent; it stays where it is drawn at the playhead. */
export function setParent(clipId: ID, parentId: ID | null) {
  const t = useTransport.getState().time;
  useProjectStore.getState().edit('ops.parent', (d) => {
    const ref = findClip(d, clipId);
    if (!ref || ref.track.locked) return;
    const clip = ref.clip;
    if (parentId && wouldCycle(d, clipId, parentId)) return;
    if (clip.parentId) unparent(d, clip, t);
    if (parentId) attach(d, clip, parentId, t);
  });
}
