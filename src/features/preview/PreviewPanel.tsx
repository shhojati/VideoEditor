import { useEffect, useLayoutEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Panel } from '../../app/ui';
import { playbackEngine } from '../../engine/playback/engine';
import type { Project } from '../../model/types';
import { CanvasOverlay } from './CanvasOverlay';
import { TransportBar } from './TransportBar';
import { backingRatio, panBy, setViewport, usePreviewView, zoomTo } from './previewView';
import { spaceHand } from './spaceHand';
import { Scopes } from './Scopes';
import { ToolBar } from '../tools/ToolBar';
import { TextEditBox } from '../tools/TextEditBox';
import { useTool } from '../tools/toolService';
import { setFullscreenTarget } from './fullscreen';

/**
 * Zoomable, pannable preview. The canvas covers the whole viewport; the engine draws the picture
 * into it through the view transform. The backing store follows the viewport size (× a capped
 * devicePixelRatio, see backingRatio), so preview cost scales with the panel, not the zoom.
 */
export function PreviewPanel({ project }: { project: Project }) {
  const { t } = useTranslation();
  const { width, height } = project.settings;
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = usePreviewView((s) => s.view);
  const viewport = usePreviewView((s) => s.viewport);

  useEffect(() => {
    const box = boxRef.current!;
    const ro = new ResizeObserver(() => setViewport({ w: box.clientWidth, h: box.clientHeight }, { w: width, h: height }));
    ro.observe(box);
    return () => ro.disconnect();
  }, [width, height]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current!;
    const r = backingRatio(window.devicePixelRatio, view.k);
    const bw = Math.max(1, Math.round(viewport.w * r));
    const bh = Math.max(1, Math.round(viewport.h * r));
    // Assigning the size clears the canvas even when unchanged; only do it when needed.
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    const sx = bw / Math.max(1, viewport.w);
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-surface-0').trim() || '#0f1115';
    playbackEngine.attach(canvas, { k: view.k * sx, ox: view.ox * sx, oy: view.oy * sx }, bg);
  }, [view, viewport]);
  useEffect(() => () => playbackEngine.attach(null), []);

  useViewportGestures(boxRef);

  return (
    <Panel title={t('panels.preview')} hideTitle>
      <div ref={setFullscreenTarget} className="flex h-full flex-col bg-surface-0" dir="ltr" data-testid="preview-panel">
        <div ref={boxRef} className="relative min-h-0 flex-1 touch-none overflow-hidden" data-testid="preview-viewport">
          <canvas ref={canvasRef} data-testid="preview-canvas" className="absolute inset-0" style={{ width: viewport.w, height: viewport.h }} />
          {/* The picture's rectangle on screen; also what layout tests measure. */}
          <div
            data-testid="preview-frame"
            className="pointer-events-none absolute shadow-[0_0_0_1px_rgba(255,255,255,0.08)]"
            style={{ left: view.ox, top: view.oy, width: width * view.k, height: height * view.k }}
          />
          <CanvasOverlay project={project} />
          <TextEditBox project={project} />
          <ToolBar />
          <Scopes />
        </div>
        <TransportBar fps={project.settings.fps} />
      </div>
    </Panel>
  );
}

/**
 * The wheel zooms about the pointer (Shift+wheel pans sideways, Ctrl+wheel up and down);
 * Space+drag, middle-drag and the hand tool pan. Two touch pointers pinch-zoom and pan together;
 * one pans with the hand tool.
 */
function useViewportGestures(boxRef: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const box = boxRef.current!;
    const local = (e: { clientX: number; clientY: number }) => {
      const r = box.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Lines/pages to pixels.
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? box.clientHeight : 1;
      if (e.ctrlKey || e.metaKey) panBy(-e.deltaX * unit, -e.deltaY * unit);
      else if (e.shiftKey) panBy(-(e.deltaX || e.deltaY) * unit, 0);
      // A sideways swipe on a touchpad pans; the wheel zooms.
      else if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) panBy(-e.deltaX * unit, 0);
      else {
        const { x, y } = local(e);
        zoomTo(usePreviewView.getState().view.k * Math.exp(-e.deltaY * unit * 0.0015), x, y);
      }
    };

    const pointers = new Map<number, { x: number; y: number }>();
    let panning: number | null = null;
    let last = { x: 0, y: 0 };
    let pinch: { dist: number; mid: { x: number; y: number } } | null = null;
    const pinchState = () => {
      const [a, b] = [...pointers.values()];
      return { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
    };

    const hand = () => useTool.getState().tool === 'hand';
    const onDown = (e: PointerEvent) => {
      // The tool strip and other controls on the preview keep their clicks.
      if ((e.target as Element).closest('[data-preview-ui]')) return;
      if (e.pointerType === 'touch') {
        pointers.set(e.pointerId, local(e));
        if (pointers.size === 2) {
          pinch = pinchState();
          panning = null;
          e.stopPropagation(); // not a tap on a clip
          box.dispatchEvent(new Event('previewpinch')); // cancels a clip drag the first finger began
          return;
        }
        if (!hand()) return;
      }
      if (e.button === 1 || (e.button === 0 && (spaceHand.held || hand()))) {
        e.preventDefault();
        e.stopPropagation();
        panning = e.pointerId;
        last = local(e);
        if (spaceHand.held) spaceHand.used = true;
        box.setPointerCapture(e.pointerId);
        box.style.cursor = 'grabbing';
      }
    };
    const onMove = (e: PointerEvent) => {
      if (pointers.has(e.pointerId)) {
        pointers.set(e.pointerId, local(e));
        if (pinch && pointers.size === 2) {
          const next = pinchState();
          panBy(next.mid.x - pinch.mid.x, next.mid.y - pinch.mid.y);
          if (pinch.dist > 0) zoomTo(usePreviewView.getState().view.k * (next.dist / pinch.dist), next.mid.x, next.mid.y);
          pinch = next;
          return;
        }
      }
      if (panning !== e.pointerId) return;
      const p = local(e);
      panBy(p.x - last.x, p.y - last.y);
      last = p;
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = null;
      if (panning === e.pointerId) {
        panning = null;
        box.style.cursor = spaceHand.held || hand() ? 'grab' : '';
      }
    };
    const onAux = (e: MouseEvent) => e.button === 1 && e.preventDefault(); // no autoscroll / paste
    const onEnter = () => (spaceHand.hover = true);
    const onLeave = () => (spaceHand.hover = false);
    const onHandChange = () => panning === null && (box.style.cursor = spaceHand.held || hand() ? 'grab' : '');

    box.addEventListener('wheel', onWheel, { passive: false });
    // Capture phase: a pan gesture must win over clip handles underneath.
    box.addEventListener('pointerdown', onDown, true);
    box.addEventListener('pointermove', onMove);
    box.addEventListener('pointerup', onUp);
    box.addEventListener('pointercancel', onUp);
    box.addEventListener('mousedown', onAux);
    box.addEventListener('auxclick', onAux);
    box.addEventListener('pointerenter', onEnter);
    box.addEventListener('pointerleave', onLeave);
    const offHand = spaceHand.subscribe(onHandChange);
    const offTool = useTool.subscribe(onHandChange);
    return () => {
      box.removeEventListener('wheel', onWheel);
      box.removeEventListener('pointerdown', onDown, true);
      box.removeEventListener('pointermove', onMove);
      box.removeEventListener('pointerup', onUp);
      box.removeEventListener('pointercancel', onUp);
      box.removeEventListener('mousedown', onAux);
      box.removeEventListener('auxclick', onAux);
      box.removeEventListener('pointerenter', onEnter);
      box.removeEventListener('pointerleave', onLeave);
      offHand();
      offTool();
      spaceHand.hover = false;
    };
  }, [boxRef]);
}
