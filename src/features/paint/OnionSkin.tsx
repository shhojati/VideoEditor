import { layerAffine, applyAffine } from '../../engine/render/masks';
import { drawnClip } from '../../engine/render/parenting';
import { outlineD, strokeOutline } from '../../engine/render/paint';
import { isActiveAt } from '../../engine/render/renderFrame';
import { celStart } from '../../model/paint';
import { keyTimeAt } from '../../model/remap';
import { findClip } from '../../model/timeline';
import type { Project } from '../../model/types';
import { usePreviewView } from '../preview/previewView';
import { useTimelineUi } from '../timeline/timelineUi';
import { useTool } from '../tools/toolService';
import { screenAffine } from './paintService';

/**
 * Onion skin for frame-by-frame paint (preview only, never exported): the drawing before the one
 * at the playhead shows faintly in red, the one after in green.
 */
export function OnionSkin({ project, time }: { project: Project; time: number }) {
  const on = useTool((s) => s.onion);
  const view = usePreviewView((s) => s.view);
  const selection = useTimelineUi((s) => s.selection);
  if (!on || time < 0 || selection.length !== 1) return null;
  const ref = findClip(project, selection[0]);
  const clip = ref?.clip;
  const hold = clip?.paint?.frames?.hold;
  if (!clip || !hold || !isActiveAt(clip, time)) return null;
  const layer = layerAffine(project, drawnClip(project, clip, time));
  if (!layer) return null;
  const S = screenAffine(view, layer);
  const map = (x: number, y: number): [number, number] => {
    const p = applyAffine(S, { x, y });
    return [p.x, p.y];
  };
  const len = hold / project.settings.fps;
  const cur = celStart(keyTimeAt(clip, time), hold, project.settings.fps);
  const drawing = (start: number) =>
    clip.paint!.strokes.filter((s) => s.tool === 'brush' && s.duration !== undefined && Math.abs(s.start - start) < 1e-3);
  return (
    <g data-testid="onion-skin" style={{ pointerEvents: 'none' }}>
      {([
        [cur - len, 'fill-red-500'],
        [cur + len, 'fill-emerald-400'],
      ] as const).map(([start, cls]) =>
        drawing(start).map((s) => <path key={s.id} d={outlineD(strokeOutline(s), map)} className={cls} fillOpacity={0.35} />),
      )}
    </g>
  );
}
