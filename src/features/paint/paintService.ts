// Painting with the brush and eraser: where a stroke goes (the selected video, photo or paint
// layer, or a new paint layer), committing it as one undo step, and editing strokes afterwards.
import { affineScale, composeAffine, layerAffine, mediaSize, type Affine } from '../../engine/render/masks';
import { withMotion } from '../../engine/render/motion';
import { isActiveAt } from '../../engine/render/renderFrame';
import { newId } from '../../model/factories';
import { keyedClip } from '../../model/keyframes';
import { isPaintLayer } from '../../model/overlays';
import { newStrokeTiming, round3 } from '../../model/paint';
import { keyTimeAt } from '../../model/remap';
import { addPaintClip, findClip } from '../../model/timeline';
import type { Clip, ID, PaintStroke, Project } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { select, useTimelineUi } from '../timeline/timelineUi';
import type { BrushSettings } from '../tools/toolService';

/** Clips a brush paints on: video and photos (on their picture) and paint layers. */
export function paintable(p: Project, clip: Clip) {
  return isPaintLayer(clip) || (!clip.text && !clip.shape && !clip.adjustment && !!mediaSize(p, clip));
}

/** The selected clip the brush paints on at timeline time t, if any (otherwise a new paint layer). */
export function paintTarget(p: Project, t: number): Clip | undefined {
  const sel = useTimelineUi.getState().selection;
  const ref = sel.length === 1 ? findClip(p, sel[0]) : undefined;
  if (!ref || ref.track.locked || !isActiveAt(ref.clip, t) || !paintable(p, ref.clip)) return undefined;
  return ref.clip;
}

/**
 * Layer units → project pixels for painting on `clip` (as it is drawn at t); for a new paint layer
 * (no clip) the frame centre at scale 1.
 */
export function paintAffine(p: Project, clip: Clip | undefined, t: number): Affine | undefined {
  if (!clip) return [1, 0, 0, 1, p.settings.width / 2, p.settings.height / 2];
  return layerAffine(p, withMotion(p, keyedClip(clip, t), t));
}

/** Layer units → screen for the preview view. */
export const screenAffine = (view: { k: number; ox: number; oy: number }, layer: Affine) => composeAffine([view.k, 0, 0, view.k, view.ox, view.oy], layer);

/** A brush diameter in project pixels, in the target's layer units. */
export const layerSize = (projectPx: number, layer: Affine) => projectPx / (affineScale(layer) || 1);

/**
 * Add a finished stroke (points in layer units) at timeline time t: to `targetId`, or to a new
 * paint layer there (selected, so the next strokes join it). One undo step.
 */
export function commitStroke(targetId: ID | undefined, tool: 'brush' | 'eraser', points: number[], pressure: boolean, brush: BrushSettings, size: number, t: number) {
  let id = targetId;
  useProjectStore.getState().edit(tool === 'eraser' ? 'ops.erase' : 'ops.paint', (d) => {
    if (!id) id = addPaintClip(d, t, { strokes: [] });
    const ref = findClip(d, id);
    if (!ref || ref.track.locked) return;
    const clip = ref.clip;
    clip.paint ??= { strokes: [] };
    const s = keyTimeAt(clip, Math.max(clip.start, t));
    const timing = newStrokeTiming(clip.paint, s, d.settings.fps);
    const stroke: PaintStroke = {
      id: newId(),
      tool,
      points: points.map(round3),
      size: round3(size),
      hardness: brush.hardness,
      opacity: brush.opacity,
      color: brush.color,
      start: round3(timing.start),
    };
    if (pressure) stroke.pressure = true;
    // Frame-by-frame drawings hold for their frames; otherwise the brush's duration.
    if (timing.duration !== undefined) stroke.duration = timing.duration;
    else if (brush.duration === 'frame') stroke.duration = 1 / d.settings.fps;
    else if (brush.duration === 'custom') stroke.duration = brush.seconds;
    if (brush.writeOn > 0 && tool === 'brush') stroke.writeOn = brush.writeOn;
    clip.paint.strokes.push(stroke);
  });
  if (id && id !== targetId) select([id]);
}

function editPaint(label: string, clipId: ID, recipe: (clip: Clip, p: Project) => void, mergeKey?: string) {
  useProjectStore.getState().edit(
    label,
    (d) => {
      const ref = findClip(d, clipId);
      if (ref?.clip.paint && !ref.track.locked) recipe(ref.clip, d);
    },
    mergeKey ? { mergeKey } : undefined,
  );
}

export function deleteStroke(clipId: ID, strokeId: ID) {
  editPaint('ops.deleteStroke', clipId, (c) => {
    c.paint!.strokes = c.paint!.strokes.filter((s) => s.id !== strokeId);
  });
}

export function setStroke(clipId: ID, strokeId: ID, change: Partial<Pick<PaintStroke, 'duration' | 'writeOn' | 'color' | 'opacity' | 'start'>>) {
  editPaint(
    'ops.strokeProp',
    clipId,
    (c) => {
      const s = c.paint!.strokes.find((x) => x.id === strokeId);
      if (!s) return;
      for (const [k, v] of Object.entries(change) as [keyof typeof change, never][]) {
        if (v === undefined) delete s[k];
        else s[k] = v;
      }
    },
    `stroke:${strokeId}:${Object.keys(change).join(',')}`,
  );
}

/** Remove every stroke (a paint layer stays, empty, so it can be painted again). */
export function clearPaint(clipId: ID) {
  editPaint('ops.clearPaint', clipId, (c) => {
    if (isPaintLayer(c)) c.paint!.strokes = [];
    else delete c.paint;
  });
}

/** Frame-by-frame drawing on or off: each drawing holds `hold` frames. */
export function setFrameByFrame(clipId: ID, hold: number | null) {
  editPaint('ops.paintFrames', clipId, (c) => {
    if (hold) c.paint!.frames = { hold };
    else delete c.paint!.frames;
  });
}
