import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { openClipMenu } from '../timeline/ClipMenu';
import { findClip } from '../../model/timeline';
import { isPaintLayer } from '../../model/overlays';
import type { Clip, ID, Project } from '../../model/types';
import { baseFromDrawn, motionTransform } from '../../engine/render/motion';
import { drawnClip, parentPose, toLocal as localOf, toWorld as worldOf } from '../../engine/render/parenting';
import { keyedEdit } from '../keyframes/keyframeService';
import { useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { select, useTimelineUi } from '../timeline/timelineUi';
import {
  applyBox,
  clipBox,
  contains,
  corners,
  editableClipsAt,
  nearPaint,
  handlesFor,
  moveLineEnd,
  resizesFreely,
  resizeBox,
  rotateTowards,
  snapMove,
  toWorld,
  type Box,
  type Pt,
} from './canvasGeometry';
import { usePreviewView, type View } from './previewView';
import { TrackerOverlay } from './TrackerOverlay';
import { MaskOverlay } from '../masks/MaskOverlay';
import { ToolOverlay } from '../tools/ToolOverlay';
import { PaintOverlay } from '../paint/PaintOverlay';
import { OnionSkin } from '../paint/OnionSkin';
import { editText, useTool } from '../tools/toolService';

/** Screen px: handle size, rotate-handle distance, drag threshold, snap distance, hit slack. */
const HANDLE = 9;
const ROTATE_OFFSET = 26;
const DRAG_THRESHOLD = 3;
const SNAP = 6;
const HIT_SLACK = 4;

let measureCtx: CanvasRenderingContext2D | null = null;
const measure = () => (measureCtx ??= document.createElement('canvas').getContext('2d')!);

type Handle =
  | { kind: 'move' }
  | { kind: 'resize'; sx: number; sy: number }
  | { kind: 'rotate' }
  | { kind: 'end'; end: -1 | 1 };

interface Gesture {
  handle: Handle;
  /** Clips being changed, with their box and scale at the start. */
  items: { id: ID; box: Box; scale: number }[];
  start: Pt;
  startScreen: Pt;
  moved: boolean;
  key: string;
}

let gestureSeq = 0;

const toScreen = (v: View, p: Pt): Pt => ({ x: v.ox + p.x * v.k, y: v.oy + p.y * v.k });
const toProject = (v: View, s: Pt): Pt => ({ x: (s.x - v.ox) / v.k, y: (s.y - v.oy) / v.k });

/** Resize cursor for a handle direction, given the box rotation. */
function resizeCursor(sx: number, sy: number, rotation: number) {
  const a = (((Math.atan2(sy, sx) + rotation) * 180) / Math.PI + 360) % 180;
  return ['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'][Math.round(a / 45) % 4];
}

/**
 * Selection outline and handles over the preview: click to select the topmost clip under the
 * pointer, drag to move (snaps to the frame centre and edges; Alt: no snap, Shift: one axis),
 * corner/edge handles resize (Shift: keep proportions, Alt: from the centre), the top handle
 * rotates (Shift: 15° steps). Each drag is one undo step; Escape cancels it.
 */
export function CanvasOverlay({ project }: { project: Project }) {
  const { t } = useTranslation();
  const svgRef = useRef<SVGSVGElement>(null);
  // While playing the overlay stays empty and does not re-render on every clock tick.
  const time = useTransport((s) => (s.playing ? -1 : s.time));
  const selection = useTimelineUi((s) => s.selection);
  const view = usePreviewView((s) => s.view);
  const viewport = usePreviewView((s) => s.viewport);
  const [hover, setHover] = useState<ID | null>(null);
  const [guides, setGuides] = useState<{ x?: number; y?: number }>({});
  const gesture = useRef<Gesture | null>(null);
  const { width: W, height: H } = project.settings;
  // Other tools (shape, type, pen…) take the clicks; handles show only for selecting.
  const tool = useTool((s) => s.tool);
  const selecting = tool === 'select';

  const active = useMemo(() => editableClipsAt(project, time), [project, time]);
  const boxes = useMemo(() => {
    const m = new Map<ID, { clip: Clip; box: Box }>();
    for (const { clip } of active) {
      // Where it is drawn now: keyframes applied, clips following a tracker moved with it, children
      // placed by their parent.
      const moved = drawnClip(project, clip, time);
      const box = clipBox(project, moved, measure(), time);
      if (box) m.set(clip.id, { clip: moved, box });
    }
    return m;
  }, [project, active, time]);

  const selectedHere = selection.filter((id) => boxes.has(id));
  const single = selectedHere.length === 1 && selection.length === 1 ? boxes.get(selectedHere[0])! : null;

  const local = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const hitTest = (screen: Pt): ID | null => {
    const p = toProject(view, screen);
    for (const { clip } of active) {
      const b = boxes.get(clip.id)?.box;
      // A paint layer spans the frame; it is picked only where it has strokes.
      if (b && contains(b, p, HIT_SLACK / view.k) && (!isPaintLayer(clip) || nearPaint(project, boxes.get(clip.id)!.clip, p, HIT_SLACK / view.k))) return clip.id;
    }
    return null;
  };

  const cancel = () => {
    const g = gesture.current;
    gesture.current = null;
    setGuides({});
    const { history, undo } = useProjectStore.getState();
    if (g?.moved && history?.past.at(-1)?.mergeKey === g.key) undo();
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && gesture.current) {
        e.stopPropagation();
        cancel();
      }
    };
    const box = svgRef.current!.parentElement!;
    window.addEventListener('keydown', onKey, true);
    box.addEventListener('previewpinch', cancel);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      box.removeEventListener('previewpinch', cancel);
    };
  }, []);

  const begin = (e: React.PointerEvent, handle: Handle, ids: ID[]) => {
    const items = ids.flatMap((id) => {
      const b = boxes.get(id);
      return b ? [{ id, box: b.box, scale: b.clip.transform.scale }] : [];
    });
    if (!items.length) return;
    const s = local(e);
    gesture.current = { handle, items, start: toProject(view, s), startScreen: s, moved: false, key: `canvas:${++gestureSeq}` };
    svgRef.current!.setPointerCapture(e.pointerId);
    // Leave text fields so shortcuts (Delete, arrows) act on the selection.
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || !selecting) return;
    const target = (e.target as Element).closest('[data-handle]')?.getAttribute('data-handle');
    if (target && single) {
      e.stopPropagation();
      const [k, a, b] = target.split(':');
      const handle: Handle =
        k === 'r' ? { kind: 'rotate' } : k === 'l' ? { kind: 'end', end: Number(a) as -1 | 1 } : { kind: 'resize', sx: Number(a), sy: Number(b) };
      begin(e, handle, [single.clip.id]);
      return;
    }
    const id = hitTest(local(e));
    if (!id) {
      select([]);
      return;
    }
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      select([id], 'toggle');
      return;
    }
    const sel = useTimelineUi.getState().selection;
    const ids = sel.includes(id) ? sel.filter((x) => boxes.has(x)) : [id];
    if (!sel.includes(id)) select([id]);
    begin(e, { kind: 'move' }, ids);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    const s = local(e);
    if (!g) {
      setHover(selecting ? hitTest(s) : null);
      return;
    }
    if (!g.moved && Math.hypot(s.x - g.startScreen.x, s.y - g.startScreen.y) < DRAG_THRESHOLD) return;
    g.moved = true;
    const p = toProject(view, s);
    const next = new Map<ID, Box>();
    let hit: { x?: number; y?: number } = {};
    if (g.handle.kind === 'move') {
      let dx = p.x - g.start.x;
      let dy = p.y - g.start.y;
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      // Snap the first (clicked) clip; the others follow by the same amount.
      const lead = g.items[0].box;
      let moved: Box = { ...lead, cx: lead.cx + dx, cy: lead.cy + dy };
      if (!e.altKey) {
        const snapped = snapMove(moved, W, H, SNAP / view.k);
        hit = snapped.guides;
        moved = { ...moved, cx: snapped.cx, cy: snapped.cy };
      }
      const ddx = moved.cx - lead.cx;
      const ddy = moved.cy - lead.cy;
      for (const it of g.items) next.set(it.id, { ...it.box, cx: it.box.cx + ddx, cy: it.box.cy + ddy });
    } else {
      const it = g.items[0];
      const clip = boxes.get(it.id)?.clip;
      if (!clip) return;
      let box: Box;
      if (g.handle.kind === 'rotate') box = { ...it.box, rotation: rotateTowards(it.box, p, e.shiftKey) };
      else if (g.handle.kind === 'end') box = moveLineEnd(it.box, g.handle.end, p, e.shiftKey);
      else {
        const isCorner = g.handle.sx !== 0 && g.handle.sy !== 0;
        const uniform = !resizesFreely(clip) || (isCorner && e.shiftKey);
        box = resizeBox(it.box, g.handle.sx, g.handle.sy, p, uniform, e.altKey);
      }
      next.set(it.id, box);
    }
    setGuides(hit);
    const label = { move: 'ops.canvasMove', resize: 'ops.canvasResize', rotate: 'ops.canvasRotate', end: 'ops.canvasResize' }[g.handle.kind];
    const now = useTransport.getState().time;
    useProjectStore.getState().edit(
      label,
      (d) => {
        for (const it of g.items) {
          const ref = findClip(d, it.id);
          const box = next.get(it.id);
          if (!ref || !box || ref.track.locked) continue;
          // On an animated clip the change lands in a keyframe at the playhead.
          keyedEdit(d, ref.clip, (c) => {
            const pose = parentPose(d, c, now);
            if (!c.motion && !pose) {
              applyBox(c, it.box, box, W, H, it.scale);
              return;
            }
            // A linked or parented clip: edit where it is drawn, then store what draws it there.
            const moved = c.motion ? motionTransform(d, c, now) : { ...c.transform };
            const drawn = { ...c, transform: pose ? worldOf(d, moved, pose) : moved };
            applyBox(drawn, it.box, box, W, H, it.scale);
            const back = pose ? localOf(d, drawn.transform, pose) : drawn.transform;
            c.transform = c.motion ? baseFromDrawn(d, c, now, back) : back;
          }, now);
        }
      },
      { mergeKey: g.key, gesture: true },
    );
  };

  const onPointerUp = () => {
    gesture.current = null;
    setGuides({});
  };

  const poly = (b: Box) =>
    corners(b)
      .map((c) => toScreen(view, c))
      .map((c) => `${c.x},${c.y}`)
      .join(' ');

  const cursor = tool === 'hand' ? 'grab' : hover ? 'move' : 'default';
  const handles = selecting && single && renderHandles(single.clip, single.box, view);

  // Double-click a text to type into it on the preview.
  const onDoubleClick = (e: React.MouseEvent) => {
    const id = selecting ? hitTest(local(e)) : null;
    if (id && boxes.get(id)?.clip.text && !findClip(project, id)?.track.locked) editText(id, `text-edit:${++gestureSeq}`);
  };

  return (
    <svg
      ref={svgRef}
      className="absolute inset-0 touch-none"
      width={viewport.w}
      height={viewport.h}
      style={{ cursor }}
      data-testid="canvas-overlay"
      aria-label={t('preview.canvasHint')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={cancel}
      onPointerLeave={() => !gesture.current && setHover(null)}
      onDoubleClick={onDoubleClick}
      onContextMenu={(e) => {
        const id = selecting ? hitTest(local(e)) : null;
        if (id) openClipMenu(e, id);
        else e.preventDefault();
      }}
    >
      {guides.x !== undefined && (
        <line x1={view.ox + guides.x * view.k} x2={view.ox + guides.x * view.k} y1={0} y2={viewport.h} className="stroke-fuchsia-400" strokeDasharray="4 3" />
      )}
      {guides.y !== undefined && (
        <line y1={view.oy + guides.y * view.k} y2={view.oy + guides.y * view.k} x1={0} x2={viewport.w} className="stroke-fuchsia-400" strokeDasharray="4 3" />
      )}
      {hover && !selection.includes(hover) && boxes.has(hover) && (
        <polygon points={poly(boxes.get(hover)!.box)} fill="none" className="stroke-sky-300/70" strokeWidth={1} />
      )}
      {/* Null objects draw nothing: a dashed square and cross show where they are. */}
      {[...boxes.values()]
        .filter((b) => b.clip.nullObject)
        .map(({ clip, box }) => {
          const c = toScreen(view, { x: box.cx, y: box.cy });
          return (
            <g key={`null:${clip.id}`} style={{ pointerEvents: 'none' }} data-testid="null-marker">
              <polygon points={poly(box)} fill="none" className="stroke-red-400/80" strokeDasharray="5 4" />
              <path d={`M${c.x - 8},${c.y}h16M${c.x},${c.y - 8}v16`} className="stroke-red-400" />
            </g>
          );
        })}
      {selectedHere.map((id) => (
        <polygon key={id} points={poly(boxes.get(id)!.box)} fill="none" className="stroke-sky-400" strokeWidth={1.5} data-testid="selection-box" data-clip-id={id} />
      ))}
      {handles}
      <TrackerOverlay project={project} time={time} />
      <OnionSkin project={project} time={time} />
      <MaskOverlay project={project} time={time} />
      <ToolOverlay project={project} time={time} hitTest={hitTest} />
      <PaintOverlay project={project} time={time} />
    </svg>
  );
}

function renderHandles(clip: Clip, box: Box, view: View) {
  const which = handlesFor(clip);
  const out: React.ReactNode[] = [];
  const at = (q: Pt) => toScreen(view, toWorld(box, q));
  const square = (key: string, p: Pt, cursor: string) => (
    <rect
      key={key}
      data-handle={key}
      x={p.x - HANDLE / 2}
      y={p.y - HANDLE / 2}
      width={HANDLE}
      height={HANDLE}
      rx={1.5}
      className="fill-white stroke-sky-500"
      style={{ cursor }}
    />
  );
  const hw = box.w / 2;
  const hh = box.h / 2;
  if (which.ends) {
    for (const end of [-1, 1] as const) {
      const p = at({ x: end * hw, y: 0 });
      out.push(<circle key={`l:${end}`} data-handle={`l:${end}`} cx={p.x} cy={p.y} r={HANDLE / 2 + 1} className="fill-white stroke-sky-500" style={{ cursor: 'crosshair' }} />);
    }
    return out;
  }
  if (which.rotate) {
    const top = at({ x: 0, y: -hh });
    const dir = { x: Math.sin(box.rotation), y: -Math.cos(box.rotation) };
    const knob = { x: top.x + dir.x * ROTATE_OFFSET, y: top.y + dir.y * ROTATE_OFFSET };
    out.push(<line key="r-line" x1={top.x} y1={top.y} x2={knob.x} y2={knob.y} className="stroke-sky-400" />);
    out.push(<circle key="r" data-handle="r" cx={knob.x} cy={knob.y} r={HANDLE / 2 + 1} className="fill-white stroke-sky-500" style={{ cursor: 'grab' }} />);
  }
  if (which.edges)
    for (const [sx, sy] of [[0, -1], [1, 0], [0, 1], [-1, 0]])
      out.push(square(`e:${sx}:${sy}`, at({ x: sx * hw, y: sy * hh }), resizeCursor(sx, sy, box.rotation)));
  if (which.corners)
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]])
      out.push(square(`c:${sx}:${sy}`, at({ x: sx * hw, y: sy * hh }), resizeCursor(sx, sy, box.rotation)));
  return out;
}
