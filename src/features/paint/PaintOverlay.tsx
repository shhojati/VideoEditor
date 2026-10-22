import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyAffine, invertAffine, type Affine } from '../../engine/render/masks';
import { outlineD, strokeOutline } from '../../engine/render/paint';
import type { Project } from '../../model/types';
import type { Pt } from '../preview/canvasGeometry';
import { usePreviewView } from '../preview/previewView';
import { useTool } from '../tools/toolService';
import { commitStroke, layerSize, paintAffine, paintTarget, screenAffine } from './paintService';

interface Live {
  targetId?: string;
  /** Layer units → screen, and back. */
  S: Affine;
  inv: Affine;
  size: number;
  points: number[];
  pressure: boolean;
}

/**
 * The brush and eraser on the preview (inside the canvas overlay's SVG). A drag paints one stroke
 * on the selected video, photo or paint layer, or on a new paint layer; a pen's pressure changes
 * the width. The stroke shows as it is drawn and becomes one undo step when the pointer lifts.
 */
export function PaintOverlay({ project, time }: { project: Project; time: number }) {
  const { t } = useTranslation();
  const tool = useTool((s) => s.tool);
  const brush = useTool((s) => s.brush);
  const view = usePreviewView((s) => s.view);
  // The stroke being drawn: the ref for the pointer handlers, the state (a fresh copy per move) to show it.
  const live = useRef<Live | null>(null);
  const [shown, setShown] = useState<Live | null>(null);
  const update = (l: Live | null) => {
    live.current = l;
    setShown(l && { ...l });
  };
  const [hover, setHover] = useState<Pt | null>(null);
  if (time < 0 || (tool !== 'brush' && tool !== 'eraser')) return null;

  const local = (e: { clientX: number; clientY: number; currentTarget: EventTarget }): Pt => {
    const r = (e.currentTarget as SVGElement).ownerSVGElement!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const add = (l: Live, e: PointerEvent | React.PointerEvent, s: Pt) => {
    const p = applyAffine(l.inv, s);
    l.points.push(p.x, p.y, l.pressure ? e.pressure || 0.5 : 0.5);
  };

  const onDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    const target = paintTarget(project, time);
    const layer = paintAffine(project, target, time);
    if (!layer) return;
    const S = screenAffine(view, layer);
    const l: Live = { targetId: target?.id, S, inv: invertAffine(S), size: layerSize(brush.size, layer), points: [], pressure: e.pointerType === 'pen' };
    add(l, e, local(e));
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    update(l);
  };
  const onMove = (e: React.PointerEvent) => {
    const s = local(e);
    setHover(s);
    const l = live.current;
    if (!l) return;
    // Every sampled position since the last event, for smooth fast strokes.
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
    if (events.length) for (const ce of events) add(l, ce, local({ clientX: ce.clientX, clientY: ce.clientY, currentTarget: e.currentTarget }));
    else add(l, e, s);
    update(l);
  };
  const onUp = () => {
    const l = live.current;
    update(null);
    if (!l) return;
    commitStroke(l.targetId, tool, l.points, l.pressure, brush, l.size, time);
  };

  const l = shown;
  let preview: React.ReactNode = null;
  if (l) {
    const outline = strokeOutline({ id: '', tool, points: l.points, pressure: l.pressure, size: l.size, hardness: 1, opacity: 1, color: brush.color, start: 0 });
    const d = outlineD(outline, (x, y) => {
      const p = applyAffine(l.S, { x, y });
      return [p.x, p.y];
    });
    preview =
      tool === 'eraser' ? (
        <path d={d} className="fill-white/35 stroke-neutral-900/50" strokeWidth={1} style={{ pointerEvents: 'none' }} />
      ) : (
        <path d={d} fill={brush.color} fillOpacity={brush.opacity} style={{ pointerEvents: 'none' }} />
      );
  }
  const r = (brush.size * view.k) / 2;
  return (
    <g data-testid="paint-overlay">
      <rect
        x={0}
        y={0}
        width="100%"
        height="100%"
        fill="transparent"
        style={{ pointerEvents: 'all', cursor: 'none' }}
        aria-label={t(tool === 'eraser' ? 'paint.eraserHint' : 'paint.brushHint')}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => update(null)}
        onPointerLeave={() => setHover(null)}
      />
      {preview}
      {hover && (
        <g style={{ pointerEvents: 'none' }}>
          <circle cx={hover.x} cy={hover.y} r={Math.max(1.5, r)} fill="none" stroke="black" strokeOpacity={0.6} strokeWidth={2.5} />
          <circle cx={hover.x} cy={hover.y} r={Math.max(1.5, r)} fill="none" stroke="white" strokeWidth={1} />
        </g>
      )}
    </g>
  );
}
