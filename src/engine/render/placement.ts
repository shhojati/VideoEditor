// Where a visual clip's media lands on the canvas for a transform. Pure; shared by rendering,
// canvas editing and motion tracking.
import type { Transform } from '../../model/types';

export interface Placement {
  /** Rectangle (centred on the origin, before rotation) the whole source frame is drawn into. */
  frame: { x: number; y: number; w: number; h: number };
  /** Visible (cropped) rectangle, same space; used as the clip path. */
  visible: { x: number; y: number; w: number; h: number };
  /** Centre of the visible rectangle on the canvas. */
  cx: number;
  cy: number;
  rotation: number;
}

/** Where a source of srcW×srcH lands on a canvas of canvasW×canvasH for a transform. Pure. */
export function placeMedia(srcW: number, srcH: number, canvasW: number, canvasH: number, tr: Transform): Placement {
  const crop = tr.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const visW = srcW * crop.width;
  const visH = srcH * crop.height;
  const fitScale = (tr.fit === 'cover' ? Math.max : Math.min)(canvasW / visW, canvasH / visH) * tr.scale;
  const w = visW * fitScale;
  const h = visH * fitScale;
  const fullW = srcW * fitScale;
  const fullH = srcH * fitScale;
  return {
    visible: { x: -w / 2, y: -h / 2, w, h },
    frame: { x: -w / 2 - crop.x * fullW, y: -h / 2 - crop.y * fullH, w: fullW, h: fullH },
    cx: canvasW / 2 + tr.x * canvasW,
    cy: canvasH / 2 + tr.y * canvasH,
    rotation: (tr.rotation * Math.PI) / 180,
  };
}
