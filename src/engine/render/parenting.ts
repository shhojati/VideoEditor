// Parenting (After Effects' Parent & Link): a child clip's transform is relative to its parent's —
// its position is an offset from the parent's centre in the parent's turned and scaled space, its
// rotation and scale add to the parent's. The parent's pose is as drawn (keyframes, tracker motion,
// its own parent), whether or not it is on screen at that moment.
import { keyedClip } from '../../model/keyframes';
import type { Clip, ID, Project, Transform } from '../../model/types';
import { withMotion } from './motion';

/** Chains longer than this are cut (they are also refused when set). */
const MAX_DEPTH = 8;
const RAD = Math.PI / 180;

/** A parent's centre (project pixels), rotation (degrees) and scale at some time. */
export interface Pose {
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

function clipById(project: Project, id: ID): Clip | undefined {
  for (const track of project.tracks) for (const c of track.clips) if (c.id === id) return c;
  return undefined;
}

/** The parent's pose at timeline time t, or undefined when the clip has none (or it is missing). */
export function parentPose(project: Project, clip: Clip, t: number, depth = 0): Pose | undefined {
  if (!clip.parentId || depth >= MAX_DEPTH) return undefined;
  const parent = clipById(project, clip.parentId);
  if (!parent || parent.id === clip.id) return undefined;
  const tr = drawnClip(project, parent, t, depth + 1).transform;
  const { width: W, height: H } = project.settings;
  return { x: W / 2 + tr.x * W, y: H / 2 + tr.y * H, rotation: tr.rotation, scale: tr.scale };
}

/** A transform relative to the parent → as drawn. */
export function toWorld(project: Project, local: Transform, pose: Pose): Transform {
  const { width: W, height: H } = project.settings;
  const a = pose.rotation * RAD;
  const lx = local.x * W * pose.scale;
  const ly = local.y * H * pose.scale;
  const x = pose.x + lx * Math.cos(a) - ly * Math.sin(a);
  const y = pose.y + lx * Math.sin(a) + ly * Math.cos(a);
  return { ...local, x: (x - W / 2) / W, y: (y - H / 2) / H, rotation: local.rotation + pose.rotation, scale: local.scale * pose.scale };
}

/** A transform as drawn → relative to the parent (the inverse of toWorld). */
export function toLocal(project: Project, world: Transform, pose: Pose): Transform {
  const { width: W, height: H } = project.settings;
  const a = -pose.rotation * RAD;
  const dx = W / 2 + world.x * W - pose.x;
  const dy = H / 2 + world.y * H - pose.y;
  const k = pose.scale || 1;
  const lx = (dx * Math.cos(a) - dy * Math.sin(a)) / k;
  const ly = (dx * Math.sin(a) + dy * Math.cos(a)) / k;
  return { ...world, x: lx / W, y: ly / H, rotation: world.rotation - pose.rotation, scale: world.scale / k };
}

/** A clip already keyed and moved (by a tracker) at t, placed by its parent. */
export function withParent(project: Project, moved: Clip, t: number, depth = 0): Clip {
  const pose = parentPose(project, moved, t, depth);
  return pose ? { ...moved, transform: toWorld(project, moved.transform, pose) } : moved;
}

/** The clip as drawn at timeline time t: keyframes, then tracker motion, then its parent. */
export function drawnClip(project: Project, clip: Clip, t: number, depth = 0): Clip {
  return withParent(project, withMotion(project, keyedClip(clip, t), t), t, depth);
}

/** Whether making `parentId` the parent of `childId` would make a loop (or is the clip itself). */
export function wouldCycle(project: Project, childId: ID, parentId: ID): boolean {
  let id: ID | undefined = parentId;
  for (let i = 0; id && i <= MAX_DEPTH; i++) {
    if (id === childId) return true;
    id = clipById(project, id)?.parentId;
  }
  return !!id;
}
