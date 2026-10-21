// Roto mask actions: draw a mask with the pen or from a ready shape, edit its path and settings at
// the playhead (keyframes when animated), and let a tracker carry it.
import { create } from 'zustand';
import { affineScale, invertAffine, mapPath, maskCarry, maskShapeAt, mediaSize } from '../../engine/render/masks';
import {
  clipKeyTimes,
  createMask,
  keyTolerance,
  lerpNumber,
  lerpPath,
  mapPaths,
  pathBounds,
  presetPath,
  setAnimated,
  setAt,
  toggleKeyAt,
  type Lerp,
  type MaskPreset,
} from '../../model/masks';
import { newId } from '../../model/factories';
import { isOverlay } from '../../model/overlays';
import { findClip } from '../../model/timeline';
import type { Animated, Clip, ID, MaskTrack, MaskVertex, Project, RotoMask, Tracker } from '../../model/types';
import { currentProject, useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { clipBox } from '../preview/canvasGeometry';
import { setActiveTracker, startTracking } from '../tracking/trackingService';
import { keyRate, keyTimeAt, keyToTimeline } from '../../model/remap';

interface MaskUiState {
  /** The mask whose points are shown and edited on the canvas. */
  active: { clipId: ID; maskId: ID } | null;
  /** A mask being drawn with the pen: its points so far, in layer units. */
  pen: { clipId: ID; points: MaskVertex[] } | null;
  /** Selected points of the active mask. */
  selected: number[];
}

export const useMasks = create<MaskUiState>()(() => ({ active: null, pen: null, selected: [] }));

export type MaskValueKey = 'feather' | 'expansion' | 'opacity';
export type MaskAnimKey = MaskValueKey | 'path';

const project = () => currentProject() ?? undefined;
const srcTime = keyTimeAt;
const lerpOf = (key: MaskAnimKey) => (key === 'path' ? lerpPath : lerpNumber) as Lerp<unknown>;
const tolerance = (p: Project, c: Clip) => keyTolerance(p.settings.fps, keyRate(c));

/** Playhead inside the clip (moving it there if needed); returns the timeline time. */
function playheadIn(clip: Clip): number {
  const { time, seek } = useTransport.getState();
  if (time >= clip.start && time < clip.start + clip.duration) return time;
  seek(clip.start);
  return clip.start;
}

export function setActiveMask(clipId: ID, maskId: ID | null) {
  useMasks.setState({ active: maskId ? { clipId, maskId } : null, selected: [] });
}

export const selectVertices = (selected: number[]) => useMasks.setState({ selected });

/** Edit one mask of one clip (skipped on locked tracks). */
function editMask(label: string, clipId: ID, maskId: ID, recipe: (m: RotoMask, clip: Clip, p: Project) => void, mergeKey?: string) {
  useProjectStore.getState().edit(
    label,
    (d) => {
      const ref = findClip(d, clipId);
      const m = ref?.clip.masks?.find((x) => x.id === maskId);
      if (ref && m && !ref.track.locked) recipe(m, ref.clip, d);
    },
    mergeKey ? { mergeKey, gesture: true } : undefined,
  );
}

// ---- adding --------------------------------------------------------------------------------------

let measureCtx: CanvasRenderingContext2D | null = null;
const measure = () => (measureCtx ??= document.createElement('canvas').getContext('2d')!);

/** Centre and size (layer units) for a ready-made mask on this clip. */
function presetFrame(p: Project, clip: Clip): { cx: number; cy: number; w: number; h: number } {
  const size = mediaSize(p, clip);
  if (size) {
    const crop = clip.transform.crop ?? { x: 0, y: 0, width: 1, height: 1 };
    return { cx: (crop.x + crop.width / 2) * size.sw, cy: (crop.y + crop.height / 2) * size.sh, w: 0.5 * crop.width * size.sw, h: 0.5 * crop.height * size.sh };
  }
  const { width: W, height: H } = p.settings;
  const box = clip.adjustment ? null : clipBox(p, clip, measure());
  const k = clip.transform.scale || 1;
  return box ? { cx: 0, cy: 0, w: (0.8 * box.w) / k, h: (0.8 * box.h) / k } : { cx: 0, cy: 0, w: 0.4 * W, h: 0.4 * H };
}

function addMask(clipId: ID, mask: RotoMask) {
  useProjectStore.getState().edit('ops.addMask', (d) => {
    const ref = findClip(d, clipId);
    if (ref && !ref.track.locked) (ref.clip.masks ??= []).push(mask);
  });
  setActiveMask(clipId, mask.id);
}

export function addPresetMask(clipId: ID, kind: MaskPreset, name: string) {
  const p = project();
  const clip = p && findClip(p, clipId)?.clip;
  if (!clip) return;
  const f = presetFrame(p!, clip);
  addMask(clipId, createMask(name, presetPath(kind, f.cx, f.cy, f.w, f.h)));
}

export function startPen(clipId: ID) {
  const p = project();
  const ref = p && findClip(p, clipId);
  const clip = ref?.clip;
  if (!clip || ref.track.locked || (!isOverlay(clip) && !mediaSize(p!, clip))) return;
  playheadIn(clip);
  useMasks.setState({ pen: { clipId, points: [] }, selected: [] });
}

export const cancelPen = () => useMasks.setState({ pen: null });

export const setPenPoints = (points: MaskVertex[]) => useMasks.setState((s) => (s.pen ? { pen: { ...s.pen, points } } : s));

/** Close the pen path into a new mask (needs three points). */
export function finishPen(name: string) {
  const pen = useMasks.getState().pen;
  useMasks.setState({ pen: null });
  if (!pen || pen.points.length < 3) return;
  const p = project();
  const clip = p && findClip(p, pen.clipId)?.clip;
  if (!clip) return;
  addMask(pen.clipId, createMask(name, pen.points));
}

export function deleteMask(clipId: ID, maskId: ID) {
  useProjectStore.getState().edit('ops.deleteMask', (d) => {
    const clip = findClip(d, clipId)?.clip;
    if (!clip?.masks) return;
    clip.masks = clip.masks.filter((m) => m.id !== maskId);
    if (!clip.masks.length) delete clip.masks;
  });
  if (useMasks.getState().active?.maskId === maskId) setActiveMask(clipId, null);
}

export function moveMask(clipId: ID, maskId: ID, dir: -1 | 1) {
  useProjectStore.getState().edit('ops.reorderMask', (d) => {
    const list = findClip(d, clipId)?.clip.masks;
    const i = list?.findIndex((m) => m.id === maskId) ?? -1;
    const j = i + dir;
    if (!list || i < 0 || j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
  });
}

export function setMaskProps(clipId: ID, maskId: ID, change: Partial<Pick<RotoMask, 'name' | 'mode' | 'inverted' | 'off'>>) {
  const label = 'name' in change ? 'ops.renameMask' : 'ops.maskProp';
  editMask(label, clipId, maskId, (m) => {
    for (const [k, v] of Object.entries(change) as [keyof typeof change, never][]) {
      if (v === false && k !== 'name') delete m[k];
      else m[k] = v;
    }
  }, 'name' in change ? `mask-name:${maskId}` : undefined);
}

// ---- values and keyframes at the playhead ---------------------------------------------------------------

/** Set feather / expansion / opacity at the playhead. Values are as drawn (a carried mask's are scaled back). */
export function setMaskValue(clipId: ID, maskId: ID, key: MaskValueKey, v: number) {
  const time = useTransport.getState().time;
  editMask(
    'ops.maskProp',
    clipId,
    maskId,
    (m, clip, p) => {
      const s = srcTime(clip, time);
      const carry = key !== 'opacity' ? maskCarry(p, clip, m, s) : undefined;
      setAt(m[key], s, carry ? v / affineScale(carry) : v, tolerance(p, clip));
    },
    `mask:${maskId}:${key}`,
  );
}

const animOf = (m: RotoMask, key: MaskAnimKey) => m[key] as Animated<unknown>;

export function setMaskAnimated(clipId: ID, maskId: ID, key: MaskAnimKey, on: boolean) {
  const time = useTransport.getState().time;
  editMask('ops.maskKey', clipId, maskId, (m, clip) => setAnimated(animOf(m, key), on, srcTime(clip, time), lerpOf(key)));
}

/** Add a keyframe at the playhead with the current value, or remove the one there. */
export function toggleMaskKey(clipId: ID, maskId: ID, key: MaskAnimKey) {
  const time = useTransport.getState().time;
  editMask('ops.maskKey', clipId, maskId, (m, clip, p) => toggleKeyAt(animOf(m, key), srcTime(clip, time), tolerance(p, clip), lerpOf(key)));
}

/** Move the playhead to the previous / next keyframe of the clip's masks (within the clip). */
export function jumpToMaskKey(clipId: ID, dir: -1 | 1, key?: { maskId: ID; anim: MaskAnimKey }) {
  const p = project();
  const clip = p && findClip(p, clipId)?.clip;
  if (!clip) return;
  const m = key && clip.masks?.find((x) => x.id === key.maskId);
  const times = (m ? (animOf(m, key!.anim).keys ?? []).map((k) => k.t) : clipKeyTimes(clip)).map((s) => keyToTimeline(clip, s));
  const now = useTransport.getState().time;
  const eps = 0.25 / p!.settings.fps;
  const target = dir === 1 ? times.find((x) => x > now + eps) : [...times].reverse().find((x) => x < now - eps);
  if (target !== undefined && target >= clip.start && target <= clip.start + clip.duration) useTransport.getState().seek(target);
}

// ---- path edits ---------------------------------------------------------------------------------------

/** The path as drawn at timeline time t (layer units, tracker applied). */
export function drawnPath(p: Project, clip: Clip, m: RotoMask, t: number): MaskVertex[] {
  return maskShapeAt(p, clip, m, srcTime(clip, t)).path;
}

/**
 * Store a path given as drawn at timeline time t: a keyframe there when the path is animated,
 * otherwise the path itself. A carried mask stores it relative to the tracker.
 */
export function setDrawnPath(clipId: ID, maskId: ID, t: number, path: MaskVertex[], mergeKey?: string) {
  editMask(
    'ops.maskPath',
    clipId,
    maskId,
    (m, clip, p) => {
      const s = srcTime(clip, t);
      const carry = maskCarry(p, clip, m, s);
      setAt(m.path, s, carry ? mapPath(path, invertAffine(carry)) : path, tolerance(p, clip));
    },
    mergeKey,
  );
}

/**
 * Change the path's points everywhere (every keyframe), e.g. add or remove a point: `fn` gets
 * each stored path. One undo step (merged into `mergeKey`'s gesture when given).
 */
export function editAllPaths(clipId: ID, maskId: ID, fn: (path: MaskVertex[]) => MaskVertex[], mergeKey?: string) {
  editMask('ops.maskPath', clipId, maskId, (m) => mapPaths(m, fn), mergeKey);
}

// ---- tracking -------------------------------------------------------------------------------------------

/** Trackers a mask on this clip can follow: its own and those on other clips of the same media. */
export function maskTrackers(p: Project, clip: Clip): Tracker[] {
  const out: Tracker[] = [];
  const seen = new Set<ID>();
  if (!mediaSize(p, clip) || p.assets[clip.assetId!]?.kind !== 'video') return out;
  for (const track of p.tracks)
    for (const c of track.clips) {
      if (c.assetId !== clip.assetId) continue;
      for (const tr of c.trackers ?? []) {
        if (seen.has(tr.id)) continue;
        seen.add(tr.id);
        out.push(tr);
      }
    }
  return out;
}

/**
 * Fold the tracker's move at source time s into the stored mask (paths, feather, expansion), so it
 * can be re-referenced at s without moving: carry_u ∘ carry_s⁻¹ is the new carry at every u.
 */
function bakeCarry(p: Project, clip: Clip, m: RotoMask, s: number) {
  const carry = maskCarry(p, clip, m, s);
  if (!carry) return;
  const k = affineScale(carry);
  mapPaths(m, (path) => mapPath(path, carry));
  for (const a of [m.feather, m.expansion]) {
    a.value *= k;
    for (const key of a.keys ?? []) key.v *= k;
  }
}

/** Carry the mask with a tracker (null: stop). The mask stays where it is drawn at the playhead. */
export function setMaskTracker(clipId: ID, maskId: ID, trackerId: ID | null) {
  const time = useTransport.getState().time;
  editMask('ops.maskTrack', clipId, maskId, (m, clip, p) => {
    const s = srcTime(clip, time);
    // Nothing jumps: the current carry is baked in and the link starts afresh at s.
    bakeCarry(p, clip, m, s);
    if (trackerId) m.track = { trackerId, position: true, rotation: true, scale: true, ref: s };
    else delete m.track;
  });
}

export function setMaskTrackParts(clipId: ID, maskId: ID, change: Partial<Pick<MaskTrack, 'position' | 'rotation' | 'scale'>>) {
  const time = useTransport.getState().time;
  editMask('ops.maskTrack', clipId, maskId, (m, clip, p) => {
    if (!m.track) return;
    // Keep the mask where it is now: re-referenced at the playhead.
    const s = srcTime(clip, time);
    bakeCarry(p, clip, m, s);
    Object.assign(m.track, change, { ref: s });
  });
}

/**
 * Track the mask: with no tracker yet, a box around the mask at the playhead becomes a new tracker
 * on this clip that carries it; then the tracker runs forward or backward.
 */
export function trackMask(clipId: ID, maskId: ID, dir: 1 | -1, trackerName: string) {
  const p = project();
  const clip = p && findClip(p, clipId)?.clip;
  const m = clip?.masks?.find((x) => x.id === maskId);
  const size = clip && mediaSize(p!, clip);
  if (!clip || !m || !size) return;
  const t = playheadIn(clip);
  let trackerId = m.track && clip.trackers?.some((x) => x.id === m.track!.trackerId) ? m.track.trackerId : null;
  if (!trackerId) {
    const b = pathBounds(drawnPath(p!, clip, m, t));
    const minSide = 16;
    const w = Math.max(minSide, b.width);
    const h = Math.max(minSide, b.height);
    trackerId = newId();
    const tracker: Tracker = {
      id: trackerId,
      name: trackerName,
      width: w / size.sw,
      height: h / size.sh,
      samples: [[srcTime(clip, t), (b.x + b.width / 2) / size.sw, (b.y + b.height / 2) / size.sh, 0, 1]],
    };
    const id = trackerId;
    useProjectStore.getState().edit('ops.trackMask', (d) => {
      const c = findClip(d, clipId)?.clip;
      const mm = c?.masks?.find((x) => x.id === maskId);
      if (!c || !mm) return;
      (c.trackers ??= []).push(tracker);
      const s = srcTime(c, t);
      bakeCarry(d, c, mm, s);
      mm.track = { trackerId: id, position: true, rotation: true, scale: true, ref: s };
    });
  }
  setActiveTracker(clipId, trackerId);
  startTracking(clipId, trackerId, dir);
}
