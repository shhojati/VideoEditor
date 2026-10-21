import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyAffine, composeAffine, invertAffine, layerAffine, mapPath, type Affine } from '../../engine/render/masks';
import { withMotion } from '../../engine/render/motion';
import { keyedClip } from '../../model/keyframes';
import { isActiveAt } from '../../engine/render/renderFrame';
import { closestOnPath, insertVertex, removeVertices, toggleSmooth, type Pt } from '../../model/masks';
import { findClip } from '../../model/timeline';
import type { MaskVertex, Project } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { usePreviewView } from '../preview/previewView';
import { useTimelineUi } from '../timeline/timelineUi';
import { cancelPen, drawnPath, editAllPaths, finishPen, selectVertices, setDrawnPath, setPenPoints, useMasks } from './maskService';

/** Screen px: point size, closing distance for the pen, drag threshold, outline hit width. */
const POINT = 8;
const CLOSE = 9;
const DRAG = 3;
const HIT = 10;

let gestureSeq = 0;

/** SVG path data for mask vertices (already in screen space). */
function pathD(path: MaskVertex[], closed: boolean) {
  if (!path.length) return '';
  const n = path.length;
  let d = `M${path[0][0]},${path[0][1]}`;
  for (let i = 0; i < (closed ? n : n - 1); i++) {
    const a = path[i];
    const b = path[(i + 1) % n];
    d += `C${a[0] + a[4]},${a[1] + a[5]} ${b[0] + b[2]},${b[1] + b[3]} ${b[0]},${b[1]}`;
  }
  return closed ? `${d}Z` : d;
}

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

type Gesture =
  | { kind: 'move' | 'points'; path0: MaskVertex[]; at0: Pt; s0: Pt; moved: boolean; key: string }
  | { kind: 'handle'; path0: MaskVertex[]; index: number; side: 'in' | 'out'; s0: Pt; moved: boolean; key: string };

/**
 * Roto masks on the preview (inside the canvas overlay's SVG). With the pen: click to add points,
 * drag to pull out curve handles, click the first point (or Enter) to close; Backspace removes the
 * last point, Escape cancels. Editing the active mask of the selected clip: drag points (Shift:
 * select several), drag a handle (Alt: only that side), drag inside to move the whole mask, click
 * the outline to add a point, Alt-click a point for corner ↔ smooth, Delete removes points. When
 * the path is animated, an edit sets a keyframe at the playhead.
 */
export function MaskOverlay({ project, time }: { project: Project; time: number }) {
  const { t } = useTranslation();
  const view = usePreviewView((s) => s.view);
  const selection = useTimelineUi((s) => s.selection);
  const pen = useMasks((s) => s.pen);
  const active = useMasks((s) => s.active);
  const selected = useMasks((s) => s.selected);
  const [hover, setHover] = useState<Pt | null>(null);
  const penDrag = useRef<{ index: number; s0: Pt; moved: boolean } | null>(null);
  const gesture = useRef<Gesture | null>(null);

  const clipId = pen?.clipId ?? (active && selection.includes(active.clipId) ? active.clipId : undefined);
  const ref = clipId && time >= 0 ? findClip(project, clipId) : undefined;
  const clip = ref && isActiveAt(ref.clip, time) ? ref.clip : undefined;
  const layer = clip && layerAffine(project, withMotion(project, keyedClip(clip, time), time));
  const S: Affine | undefined = layer && composeAffine([view.k, 0, 0, view.k, view.ox, view.oy], layer);
  const mask = !pen && clip && active ? clip.masks?.find((m) => m.id === active.maskId) : undefined;
  const editable = !!ref && !ref.track.locked;

  const cancelGesture = () => {
    const g = gesture.current;
    gesture.current = null;
    const { history, undo } = useProjectStore.getState();
    if (g?.moved && history?.past.at(-1)?.mergeKey === g.key) undo();
  };

  // Keys while drawing or editing: captured before the app's shortcuts (Delete would remove the clip).
  useEffect(() => {
    if (!pen && !mask) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const stop = () => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      const st = useMasks.getState();
      if (st.pen) {
        if (e.key === 'Enter') {
          stop();
          finishPen(t('masks.nameN', { n: (clip?.masks?.length ?? 0) + 1 }));
        } else if (e.key === 'Escape') {
          stop();
          cancelPen();
        } else if (e.key === 'Backspace' || e.key === 'Delete') {
          stop();
          setPenPoints(st.pen.points.slice(0, -1));
        }
        return;
      }
      if (e.key === 'Escape' && gesture.current) {
        stop();
        cancelGesture();
      } else if (e.key === 'Escape' && st.selected.length) {
        stop();
        selectVertices([]);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && st.selected.length && st.active && editable) {
        stop();
        const gone = new Set(st.selected);
        editAllPaths(st.active.clipId, st.active.maskId, (p) => removeVertices(p, gone));
        selectVertices([]);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  if (!clip || !S) return null;
  const Sinv = invertAffine(S);
  const toLayer = (s: Pt) => applyAffine(Sinv, s);
  const local = (e: React.PointerEvent): Pt => {
    const svg = (e.currentTarget as SVGElement).ownerSVGElement ?? (e.currentTarget as SVGSVGElement);
    const r = svg.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const capture = (e: React.PointerEvent) => {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  // ---- pen -------------------------------------------------------------------------------------------
  if (pen) {
    const points = pen.points;
    const screenPts = mapPath(points, S);
    const closable = points.length >= 3;
    const nearFirst = (s: Pt, pts: MaskVertex[] = points) => {
      if (pts.length < 3) return false;
      const first = applyAffine(S, { x: pts[0][0], y: pts[0][1] });
      return Math.hypot(s.x - first.x, s.y - first.y) <= CLOSE;
    };
    const onDown = (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      capture(e);
      const s = local(e);
      // The store, not this render's points: quick clicks can come before a re-render.
      const cur = useMasks.getState().pen?.points ?? [];
      if (nearFirst(s, cur)) {
        finishPen(t('masks.nameN', { n: (clip.masks?.length ?? 0) + 1 }));
        return;
      }
      const p = toLayer(s);
      setPenPoints([...cur, [p.x, p.y, 0, 0, 0, 0]]);
      penDrag.current = { index: cur.length, s0: s, moved: false };
    };
    const onMove = (e: React.PointerEvent) => {
      const s = local(e);
      setHover(s);
      const d = penDrag.current;
      if (!d) return;
      if (!d.moved && Math.hypot(s.x - d.s0.x, s.y - d.s0.y) < DRAG) return;
      d.moved = true;
      // Dragging pulls out a smooth point's handles.
      const cur = useMasks.getState().pen?.points;
      const v = cur?.[d.index];
      if (!cur || !v) return;
      const p = toLayer(s);
      const out: MaskVertex = [v[0], v[1], v[0] - p.x, v[1] - p.y, p.x - v[0], p.y - v[1]];
      setPenPoints(cur.map((x, i) => (i === d.index ? out : x)));
    };
    const onUp = () => (penDrag.current = null);
    const last = screenPts[screenPts.length - 1];
    return (
      <g data-testid="mask-pen">
        <rect
          x={0}
          y={0}
          width="100%"
          height="100%"
          fill="transparent"
          style={{ pointerEvents: 'all', cursor: hover && nearFirst(hover) ? 'pointer' : 'crosshair' }}
          aria-label={t('masks.penHint')}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onPointerLeave={() => setHover(null)}
        />
        <path d={pathD(screenPts, false)} fill="none" className="stroke-yellow-300" strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
        {last && hover && (
          <line x1={last[0]} y1={last[1]} x2={hover.x} y2={hover.y} className="stroke-yellow-300/60" strokeDasharray="4 3" style={{ pointerEvents: 'none' }} />
        )}
        {screenPts.map((v, i) => (
          <rect
            key={i}
            x={v[0] - POINT / 2}
            y={v[1] - POINT / 2}
            width={POINT}
            height={POINT}
            className={i === 0 && closable ? 'fill-yellow-300 stroke-yellow-700' : 'fill-white stroke-yellow-600'}
            style={{ pointerEvents: 'none' }}
          />
        ))}
      </g>
    );
  }

  if (!mask) return null;

  // ---- editing the active mask --------------------------------------------------------------------------
  const path = drawnPath(project, clip, mask, time);
  const screen = mapPath(path, S);
  const ids = { clipId: clip.id, maskId: mask.id };

  const begin = (e: React.PointerEvent, g: Gesture) => {
    capture(e);
    gesture.current = g;
  };
  const onDownInside = (e: React.PointerEvent) => {
    if (e.button !== 0 || !editable) return;
    const s = local(e);
    begin(e, { kind: 'move', path0: path, at0: toLayer(s), s0: s, moved: false, key: `mask:${++gestureSeq}` });
  };
  const onDownOutline = (e: React.PointerEvent) => {
    if (e.button !== 0 || !editable) return;
    const s = local(e);
    const c = closestOnPath(path, toLayer(s));
    const key = `mask:${++gestureSeq}`;
    // Add a point there (in every keyframe) and keep dragging it, all one undo step.
    editAllPaths(ids.clipId, ids.maskId, (p) => insertVertex(p, c.seg, c.u), key);
    selectVertices([c.seg + 1]);
    begin(e, { kind: 'points', path0: insertVertex(path, c.seg, c.u), at0: toLayer(s), s0: s, moved: true, key });
  };
  const onDownPoint = (e: React.PointerEvent, i: number) => {
    if (e.button !== 0 || !editable) return;
    if (e.altKey) {
      e.stopPropagation();
      setDrawnPath(ids.clipId, ids.maskId, time, toggleSmooth(path, i));
      return;
    }
    if (e.shiftKey) {
      e.stopPropagation();
      selectVertices(selected.includes(i) ? selected.filter((x) => x !== i) : [...selected, i]);
      return;
    }
    if (!selected.includes(i)) selectVertices([i]);
    const s = local(e);
    begin(e, { kind: 'points', path0: path, at0: toLayer(s), s0: s, moved: false, key: `mask:${++gestureSeq}` });
  };
  const onDownHandle = (e: React.PointerEvent, index: number, side: 'in' | 'out') => {
    if (e.button !== 0 || !editable) return;
    begin(e, { kind: 'handle', path0: path, index, side, s0: local(e), moved: false, key: `mask:${++gestureSeq}` });
  };

  const onMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (!g) return;
    const s = local(e);
    if (!g.moved && Math.hypot(s.x - g.s0.x, s.y - g.s0.y) < DRAG) return;
    g.moved = true;
    const p = toLayer(s);
    let next: MaskVertex[];
    if (g.kind === 'handle') {
      next = g.path0.map((v) => [...v] as MaskVertex);
      const v = next[g.index];
      const rel = { x: p.x - v[0], y: p.y - v[1] };
      const [mine, other] = g.side === 'out' ? [4, 2] : [2, 4];
      v[mine] = rel.x;
      v[mine + 1] = rel.y;
      if (!e.altKey) {
        // The other handle stays opposite, keeping its length (a smooth point).
        const len = Math.hypot(rel.x, rel.y) || 1;
        const keep = Math.hypot(v[other], v[other + 1]) || len;
        v[other] = (-rel.x / len) * keep;
        v[other + 1] = (-rel.y / len) * keep;
      }
    } else {
      const dx = p.x - g.at0.x;
      const dy = p.y - g.at0.y;
      const moving = g.kind === 'move' ? null : new Set(useMasks.getState().selected);
      next = g.path0.map((v, i) => (!moving || moving.has(i) ? [v[0] + dx, v[1] + dy, v[2], v[3], v[4], v[5]] : v));
    }
    setDrawnPath(ids.clipId, ids.maskId, time, next, g.key);
  };
  const onUp = () => (gesture.current = null);

  const others = (clip.masks ?? []).filter((m) => m.id !== mask.id && !m.off);
  // Handles of the selected points (none for a corner).
  const handles = (editable ? selected.filter((i) => i < screen.length) : []).flatMap((i) => {
    const v = screen[i];
    return (['in', 'out'] as const).flatMap((side) => {
      const x = v[0] + (side === 'in' ? v[2] : v[4]);
      const y = v[1] + (side === 'in' ? v[3] : v[5]);
      return Math.hypot(x - v[0], y - v[1]) < 0.5 ? [] : [{ i, side, x, y, vx: v[0], vy: v[1] }];
    });
  });
  return (
    <g data-testid="mask-editor" data-mask-id={mask.id} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {others.map((m) => (
        <path key={m.id} d={pathD(mapPath(drawnPath(project, clip, m, time), S), true)} fill="none" className="stroke-yellow-300/40" strokeWidth={1} style={{ pointerEvents: 'none' }} />
      ))}
      <path
        d={pathD(screen, true)}
        fill="transparent"
        stroke="none"
        style={{ pointerEvents: editable ? 'fill' : 'none', cursor: 'move' }}
        aria-label={t('masks.editHint')}
        onPointerDown={onDownInside}
      />
      <path
        d={pathD(screen, true)}
        fill="none"
        stroke="transparent"
        strokeWidth={HIT}
        data-testid="mask-outline"
        style={{ pointerEvents: editable ? 'stroke' : 'none', cursor: 'copy' }}
        onPointerDown={onDownOutline}
      />
      <path d={pathD(screen, true)} fill="none" className={mask.off ? 'stroke-yellow-300/40' : 'stroke-yellow-300'} strokeWidth={1.5} style={{ pointerEvents: 'none' }} />
      {handles.map((h) => (
        <g key={`${h.i}:${h.side}`}>
          <line x1={h.vx} y1={h.vy} x2={h.x} y2={h.y} className="stroke-yellow-200/70" style={{ pointerEvents: 'none' }} />
          <circle
            cx={h.x}
            cy={h.y}
            r={POINT / 2 - 0.5}
            data-testid="mask-handle"
            className="fill-yellow-100 stroke-yellow-700"
            style={{ pointerEvents: 'all', cursor: 'crosshair' }}
            onPointerDown={(e) => onDownHandle(e, h.i, h.side)}
          />
        </g>
      ))}
      {screen.map((v, i) => {
        const on = selected.includes(i);
        return (
          <rect
            key={i}
            data-testid="mask-point"
            data-index={i}
            x={v[0] - POINT / 2}
            y={v[1] - POINT / 2}
            width={POINT}
            height={POINT}
            className={on ? 'fill-yellow-300 stroke-yellow-800' : 'fill-white/90 stroke-yellow-600'}
            style={{ pointerEvents: editable ? 'all' : 'none', cursor: 'move' }}
            onPointerDown={(e) => onDownPoint(e, i)}
          />
        );
      })}
    </g>
  );
}
