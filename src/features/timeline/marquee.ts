// Rubber-band selection: drag on empty lane background to select every clip the box touches.
// Clips are virtualised horizontally, so the box is hit-tested against the model, not the DOM.
import type { PointerEvent as ReactPointerEvent } from 'react';
import { create } from 'zustand';
import { blurTextFields } from '../../lib/focus';
import type { ID, Project } from '../../model/types';
import { currentProject } from '../../store/projectStore';
import { select, useTimelineUi } from './timelineUi';

/** Below this the gesture is a click on the lane. */
const CLICK_PX = 4;
/** Auto-scroll starts this close to the left or right edge of the lanes. */
const EDGE_PX = 32;
/** Auto-scroll speed at the very edge, px per frame. */
const EDGE_SPEED = 18;

/** The box being drawn: times (s) horizontally, scroll-content pixels vertically. */
export interface MarqueeBox {
  t0: number;
  t1: number;
  y0: number;
  y1: number;
}

export const useMarquee = create<{ box: MarqueeBox | null }>()(() => ({ box: null }));

/** Unlocked clips on `trackIds` whose span overlaps [t0, t1], in model order. */
export function clipsInRange(p: Project, trackIds: ReadonlySet<ID>, t0: number, t1: number): ID[] {
  return p.tracks
    .filter((tr) => trackIds.has(tr.id) && !tr.locked)
    .flatMap((tr) => tr.clips.filter((c) => c.start <= t1 && c.start + c.duration >= t0).map((c) => c.id));
}

const sameIds = (a: readonly ID[], b: readonly ID[]) => a.length === b.length && a.every((id, i) => id === b[i]);

/**
 * Starts a marquee from a pointer-down on empty lane background (mouse or pen). A plain drag
 * replaces the selection, Shift/Ctrl/Meta adds to the one held at pointer-down; Esc or a cancelled
 * pointer puts that selection back. Moving less than CLICK_PX clears the selection like a click.
 */
export function beginMarquee(e: ReactPointerEvent<HTMLElement>) {
  const scroller = e.currentTarget.closest<HTMLElement>('[data-testid=timeline]');
  if (!scroller) return;
  e.preventDefault();
  blurTextFields();
  e.currentTarget.setPointerCapture(e.pointerId);

  const additive = e.shiftKey || e.ctrlKey || e.metaKey;
  const initial = useTimelineUi.getState().selection;
  const startX = e.clientX;
  const startY = e.clientY;
  let last = { x: e.clientX, y: e.clientY };
  let moved = false;
  let frame = 0;

  /** Pointer position in scroll-content coordinates: time (s) and y (px). */
  const toContent = (clientX: number, clientY: number) => {
    const r = scroller.getBoundingClientRect();
    const { pps, headerWidth } = useTimelineUi.getState();
    const x = clientX - r.left + scroller.scrollLeft;
    return { t: Math.max(0, (x - headerWidth) / pps), y: clientY - r.top + scroller.scrollTop };
  };
  const anchor = toContent(startX, startY);

  const update = () => {
    const at = toContent(last.x, last.y);
    const box: MarqueeBox = {
      t0: Math.min(anchor.t, at.t),
      t1: Math.max(anchor.t, at.t),
      y0: Math.min(anchor.y, at.y),
      y1: Math.max(anchor.y, at.y),
    };
    useMarquee.setState({ box });

    // Tracks whose lane rows overlap the box vertically.
    const top = scroller.getBoundingClientRect().top - scroller.scrollTop;
    const trackIds = new Set<ID>();
    for (const lane of scroller.querySelectorAll<HTMLElement>('[data-lane][data-track-id]')) {
      const r = lane.getBoundingClientRect();
      if (lane.dataset.trackId && r.bottom - top > box.y0 && r.top - top < box.y1) trackIds.add(lane.dataset.trackId);
    }
    const p = currentProject();
    const hits = p ? clipsInRange(p, trackIds, box.t0, box.t1) : [];
    const next = additive ? [...initial, ...hits.filter((id) => !initial.includes(id))] : hits;
    if (!sameIds(next, useTimelineUi.getState().selection)) select(next);
  };

  // Scroll sideways while the pointer is near either edge of the lanes.
  const autoScroll = () => {
    frame = requestAnimationFrame(autoScroll);
    const r = scroller.getBoundingClientRect();
    const { scrollX, headerWidth } = useTimelineUi.getState();
    const left = r.left + headerWidth;
    const right = r.left + scroller.clientWidth;
    let dx = 0;
    if (last.x < left + EDGE_PX) dx = -EDGE_SPEED * Math.min(1, (left + EDGE_PX - last.x) / EDGE_PX);
    else if (last.x > right - EDGE_PX) dx = EDGE_SPEED * Math.min(1, (last.x - (right - EDGE_PX)) / EDGE_PX);
    if (!dx) return;
    const max = scroller.scrollWidth - scroller.clientWidth;
    const x = Math.min(max, Math.max(0, scrollX + dx));
    if (x === scrollX) return;
    useTimelineUi.setState({ scrollX: x });
    // The panel applies scrollX to the DOM in a layout effect; hit-test once it has.
    requestAnimationFrame(() => moved && update());
  };

  const onMove = (ev: PointerEvent) => {
    if (ev.pointerId !== e.pointerId) return;
    last = { x: ev.clientX, y: ev.clientY };
    if (!moved && Math.hypot(ev.clientX - startX, ev.clientY - startY) < CLICK_PX) return;
    if (!moved) frame = requestAnimationFrame(autoScroll);
    moved = true;
    update();
  };

  const finish = (restore: boolean) => {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    window.removeEventListener('keydown', onKey);
    cancelAnimationFrame(frame);
    useMarquee.setState({ box: null });
    if (restore) select(initial);
    else if (!moved && !additive) select([]);
  };
  const onUp = (ev: PointerEvent) => ev.pointerId === e.pointerId && finish(false);
  const onCancel = (ev: PointerEvent) => ev.pointerId === e.pointerId && finish(true);
  const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && finish(true);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  window.addEventListener('keydown', onKey);
}
