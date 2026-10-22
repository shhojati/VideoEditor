import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyAffine, composeAffine, invertAffine, layerAffine, mediaSize } from '../../engine/render/masks';
import { withMotion } from '../../engine/render/motion';
import { keyedClip } from '../../model/keyframes';
import type { MaskPreset } from '../../model/masks';
import { keepsAspect } from '../../model/overlays';
import { findClip } from '../../model/timeline';
import type { Clip, ID, Project, ShapeKind } from '../../model/types';
import { addPresetMask } from '../masks/maskService';
import type { Pt } from '../preview/canvasGeometry';
import { usePreviewView } from '../preview/previewView';
import { addShape, addText } from '../timeline/actions';
import { select, useTimelineUi } from '../timeline/timelineUi';
import { editText, setTool, useTool } from './toolService';

/** Screen px: below this a drag counts as a click. */
const DRAG = 3;

let seq = 0;

const MASK_OF: Record<ShapeKind, MaskPreset> = {
  rectangle: 'rectangle',
  square: 'rectangle',
  line: 'rectangle',
  circle: 'ellipse',
  oval: 'ellipse',
  triangle: 'polygon',
  star: 'polygon',
  path: 'polygon',
};

/** A clip the shape tool draws a mask on instead of a new shape (as After Effects does with a layer selected). */
function maskTarget(project: Project, id: ID | undefined, time: number): Clip | undefined {
  const ref = id ? findClip(project, id) : undefined;
  if (!ref || ref.track.locked) return undefined;
  const c = ref.clip;
  if (c.text || c.shape || time < c.start || time >= c.start + c.duration) return undefined;
  return c.adjustment || mediaSize(project, c) ? c : undefined;
}

/**
 * The shape and type tools on the preview (inside the canvas overlay's SVG). Shape: drag a box (Shift:
 * square, a line goes from where the drag starts to where it ends); with a video, image or
 * adjustment layer selected it draws a mask on it instead. Type: click to start a new text there, or
 * click a text to edit it.
 */
export function ToolOverlay({ project, time, hitTest }: { project: Project; time: number; hitTest: (screen: Pt) => ID | null }) {
  const { t } = useTranslation();
  const tool = useTool((s) => s.tool);
  const kind = useTool((s) => s.shapeKind);
  const view = usePreviewView((s) => s.view);
  const selection = useTimelineUi((s) => s.selection);
  const [drag, setDrag] = useState<{ a: Pt; b: Pt; shift: boolean } | null>(null);
  // The latest drag, for pointer-up: it can come before a re-render with the last move.
  const dragRef = useRef(drag);
  const setBoth = (d: typeof drag) => {
    dragRef.current = d;
    setDrag(d);
  };
  if (time < 0 || (tool !== 'shape' && tool !== 'text')) return null;

  const target = tool === 'shape' && selection.length === 1 ? maskTarget(project, selection[0], time) : undefined;
  const local = (e: React.PointerEvent): Pt => {
    const r = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const toProject = (s: Pt): Pt => ({ x: (s.x - view.ox) / view.k, y: (s.y - view.oy) / view.k });

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const s = local(e);
    if (tool === 'text') {
      // No mouse events after this one: their default would take the focus from the new text box.
      e.preventDefault();
      const hit = hitTest(s);
      const clip = hit ? findClip(project, hit)?.clip : undefined;
      const key = `text-tool:${++seq}`;
      if (clip?.text) {
        select([hit!]);
        editText(hit!, key);
      } else {
        const p = toProject(s);
        editText(addText('', { cx: p.x, cy: p.y }, key), key, true);
      }
      // Typing happens in the box; the preview is back to selecting (Escape, a click outside).
      setTool('select');
      return;
    }
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setBoth({ a: s, b: s, shift: e.shiftKey });
  };
  const onMove = (e: React.PointerEvent) => dragRef.current && setBoth({ ...dragRef.current, b: local(e), shift: e.shiftKey });
  const onUp = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const drag = { ...dragRef.current, b: local(e), shift: e.shiftKey };
    setBoth(null);
    const clicked = Math.hypot(drag.b.x - drag.a.x, drag.b.y - drag.a.y) < DRAG;
    if (target) {
      const S = layerAffine(project, withMotion(project, keyedClip(target, time), time));
      if (!S) return;
      const inv = invertAffine(composeAffine([view.k, 0, 0, view.k, view.ox, view.oy], S));
      const b = squareUp(applyAffine(inv, drag.a), applyAffine(inv, drag.b), drag.shift);
      const name = t('masks.nameN', { n: (target.masks?.length ?? 0) + 1 });
      addPresetMask(target.id, MASK_OF[kind], name, clicked ? undefined : b);
      return;
    }
    const a = toProject(drag.a);
    const b = toProject(drag.b);
    if (clicked) addShape(kind, { cx: a.x, cy: a.y });
    else if (kind === 'line') {
      const angle = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
      addShape(kind, { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, w: Math.hypot(b.x - a.x, b.y - a.y), rotation: Math.round(angle * 100) / 100 });
    } else addShape(kind, squareUp(a, b, drag.shift || keepsAspect(kind)));
  };

  // The box being dragged, on screen.
  let preview: React.ReactNode = null;
  if (drag) {
    if (tool === 'shape' && kind === 'line' && !target) preview = <line x1={drag.a.x} y1={drag.a.y} x2={drag.b.x} y2={drag.b.y} className="stroke-sky-300" strokeWidth={2} />;
    else {
      const b = squareUp(drag.a, drag.b, drag.shift || (!target && keepsAspect(kind)));
      const round = MASK_OF[kind] === 'ellipse';
      preview = round ? (
        <ellipse cx={b.cx} cy={b.cy} rx={b.w / 2} ry={b.h / 2} fill="none" className={target ? 'stroke-yellow-300' : 'stroke-sky-300'} strokeDasharray="4 3" />
      ) : (
        <rect x={b.cx - b.w / 2} y={b.cy - b.h / 2} width={b.w} height={b.h} fill="none" className={target ? 'stroke-yellow-300' : 'stroke-sky-300'} strokeDasharray="4 3" />
      );
    }
  }

  return (
    <g data-testid="tool-overlay">
      <rect
        x={0}
        y={0}
        width="100%"
        height="100%"
        fill="transparent"
        style={{ pointerEvents: 'all', cursor: tool === 'text' ? 'text' : 'crosshair' }}
        aria-label={t(tool === 'text' ? 'tools.textHint' : target ? 'tools.maskHint' : 'tools.shapeHint')}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setBoth(null)}
      />
      {preview}
    </g>
  );
}

/** The box between two corners (Shift: a square on the longer side, kept at the first corner). */
export function squareUp(a: Pt, b: Pt, square: boolean) {
  let w = b.x - a.x;
  let h = b.y - a.y;
  if (square) {
    const m = Math.max(Math.abs(w), Math.abs(h));
    w = Math.sign(w || 1) * m;
    h = Math.sign(h || 1) * m;
  }
  return { cx: a.x + w / 2, cy: a.y + h / 2, w: Math.abs(w), h: Math.abs(h) };
}
