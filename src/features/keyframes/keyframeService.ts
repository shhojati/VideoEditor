// Keyframe actions on the store: the ◆ button at the playhead, jumping between keyframes, easing and
// retiming a keyframe by dragging its diamond on the timeline. Value edits elsewhere (inspector,
// canvas) go through keyedEdit, so on an animated clip they land in a keyframe at the playhead.
import type { PointerEvent as ReactPointerEvent } from 'react';
import { addKeyAt, clearKeys, editAt, keyIndexAt, keyTolerance, moveKey, removeKey, setKeyEase, srcTime, timelineTime } from '../../model/keyframes';
import { blurTextFields } from '../../lib/focus';
import { findClip } from '../../model/timeline';
import type { Clip, ID, KeyEase, Project } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { select, useTimelineUi } from '../timeline/timelineUi';

const project = () => useProjectStore.getState().history?.present;

export const isInside = (clip: Clip, t: number) => t >= clip.start && t < clip.start + clip.duration;

/** The playhead, held inside the clip. */
export const playheadIn = (clip: Clip, time = useTransport.getState().time) => Math.min(clip.start + clip.duration, Math.max(clip.start, time));

export const tolOf = (p: Project, clip: Clip) => keyTolerance(p.settings.fps, clip.speed);

/** Index of the keyframe under the playhead, or -1. */
export const keyAtPlayhead = (p: Project, clip: Clip, time?: number) => keyIndexAt(clip, srcTime(clip, playheadIn(clip, time)), tolOf(p, clip));

/** Edit a clip (inside a store edit) as it looks at the playhead; on an animated clip the change becomes a keyframe there. */
export function keyedEdit(p: Project, clip: Clip, recipe: (c: Clip) => void, time?: number) {
  editAt(clip, srcTime(clip, playheadIn(clip, time)), tolOf(p, clip), recipe);
}

function editClip(label: string, clipId: ID, fn: (clip: Clip, p: Project) => void, mergeKey?: string) {
  useProjectStore.getState().edit(
    label,
    (d) => {
      const ref = findClip(d, clipId);
      if (ref && !ref.track.locked) fn(ref.clip, d);
    },
    mergeKey ? { mergeKey, gesture: true } : undefined,
  );
}

/** The ◆ button: add a keyframe at the playhead, or remove the one there. */
export function toggleKeyframe(clipId: ID) {
  const p = project();
  const clip = p && findClip(p, clipId)?.clip;
  if (!clip || !isInside(clip, useTransport.getState().time)) return;
  const here = keyAtPlayhead(p!, clip) >= 0;
  editClip(here ? 'ops.removeKeyframe' : 'ops.addKeyframe', clipId, (c, d) => {
    const s = srcTime(c, playheadIn(c));
    const i = keyIndexAt(c, s, tolOf(d, c));
    if (i >= 0) removeKey(c, i);
    else addKeyAt(c, s, tolOf(d, c));
  });
}

/** The single selected clip, if any (keyboard shortcuts act on it). */
const selectedClip = () => {
  const sel = useTimelineUi.getState().selection;
  return sel.length === 1 ? sel[0] : undefined;
};

export function toggleSelectedKeyframe() {
  const id = selectedClip();
  if (id) toggleKeyframe(id);
}

/** Move the playhead to the previous / next keyframe inside the clip. */
export function jumpToKeyframe(clipId: ID, dir: -1 | 1) {
  const p = project();
  const clip = p && findClip(p, clipId)?.clip;
  if (!clip?.keyframes) return;
  const times = clip.keyframes.map((k) => timelineTime(clip, k.t)).filter((x) => x >= clip.start - 1e-6 && x <= clip.start + clip.duration + 1e-6);
  const now = useTransport.getState().time;
  const eps = 0.25 / p!.settings.fps;
  const target = dir === 1 ? times.find((x) => x > now + eps) : [...times].reverse().find((x) => x < now - eps);
  if (target !== undefined) useTransport.getState().seek(Math.min(target, clip.start + clip.duration - 1e-3));
}

export function jumpSelectedKeyframe(dir: -1 | 1) {
  const id = selectedClip();
  if (id) jumpToKeyframe(id, dir);
}

/** Ease from the keyframe under the playhead to the next one. */
export function setEaseAtPlayhead(clipId: ID, ease: KeyEase) {
  editClip('ops.keyframeEase', clipId, (c, d) => setKeyEase(c, keyAtPlayhead(d, c), ease));
}

/** Stop animating, keeping the clip as it looks at the playhead. */
export function clearKeyframes(clipId: ID) {
  editClip('ops.clearKeyframes', clipId, (c) => clearKeys(c, srcTime(c, playheadIn(c))));
}

let dragSeq = 0;

/**
 * Pointer down on a keyframe diamond: select the clip and put the playhead on the keyframe; dragging
 * retimes it (one undo step, Escape cancels). It stays inside the clip and never lands on another.
 */
export function beginKeyDrag(e: ReactPointerEvent, clipId: ID, index: number) {
  if (e.button !== 0) return;
  e.stopPropagation();
  e.preventDefault();
  blurTextFields();
  const p = project();
  const ref = p && findClip(p, clipId);
  const key = ref?.clip.keyframes?.[index];
  if (!ref || !key) return;
  const clip = ref.clip;
  select([clipId]);
  const t0 = timelineTime(clip, key.t);
  useTransport.getState().seek(Math.min(t0, clip.start + clip.duration - 1e-3));
  if (ref.track.locked) return;
  const startX = e.clientX;
  const mergeKey = `keydrag:${++dragSeq}`;
  let current = index;
  let moved = false;

  const onMove = (ev: PointerEvent) => {
    if (!moved && Math.abs(ev.clientX - startX) < 3) return;
    moved = true;
    const fps = p!.settings.fps;
    // Whole frames, kept inside the clip.
    const raw = t0 + (ev.clientX - startX) / useTimelineUi.getState().pps;
    const t = Math.min(clip.start + clip.duration - 1 / fps, Math.max(clip.start, Math.round(raw * fps) / fps));
    editClip('ops.moveKeyframe', clipId, (c, d) => void (current = moveKey(c, current, srcTime(c, t), tolOf(d, c))), mergeKey);
    useTransport.getState().seek(t);
  };
  const finish = (commit: boolean) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey, true);
    if (!commit && moved) {
      const { history, undo } = useProjectStore.getState();
      if (history?.past.at(-1)?.mergeKey === mergeKey) undo();
      useTransport.getState().seek(t0);
    }
  };
  const onUp = () => finish(true);
  const onCancel = () => finish(false);
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    ev.stopPropagation();
    finish(false);
  };
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey, true);
}
