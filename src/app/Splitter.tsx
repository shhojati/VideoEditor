import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_COLUMN_SHARE,
  DEFAULT_TIMELINE_SHARE,
  setColumnShare,
  setTimelineShare,
  useColumnShare,
  useTimelineShare,
  type Column,
  type LayoutKind,
} from './layout';

/** Smallest timeline that still shows the toolbar, ruler and a track. */
const MIN_TIMELINE_PX = 120;
/** Largest share, so the panels / preview above keep some room. */
const MAX_SHARE = 0.75;
const KEY_STEP = 0.05;

/**
 * Drag handle on the top edge of the timeline: dragging sets the timeline's share of its parent's
 * height. Arrow keys nudge it, Home/double-click restore the default.
 */
export function TimelineSplitter({ kind, target }: { kind: LayoutKind; target: RefObject<HTMLElement | null> }) {
  const { t } = useTranslation();
  const share = useTimelineShare((s) => s[kind]);

  const clampShare = (s: number) => {
    const total = target.current?.parentElement?.clientHeight ?? 0;
    const min = total ? MIN_TIMELINE_PX / total : 0;
    return Math.min(MAX_SHARE, Math.max(min, s));
  };
  const set = (s: number) => setTimelineShare(kind, clampShare(s));

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={t('panels.resizeTimeline')}
      aria-valuenow={Math.round(share * 100)}
      aria-valuemin={0}
      aria-valuemax={Math.round(MAX_SHARE * 100)}
      tabIndex={0}
      data-testid="timeline-splitter"
      className={`group flex shrink-0 cursor-row-resize touch-none items-center justify-center bg-surface-0 select-none ${
        kind === 'mobile' ? 'h-3.5 border-t border-line' : 'h-3 hover:bg-accent/30'
      }`}
      onPointerDown={(e) => {
        const el = target.current;
        if (!el?.parentElement) return;
        // The timeline's bottom edge stays put; its top follows the pointer.
        const bottom = el.getBoundingClientRect().bottom;
        const total = el.parentElement.clientHeight;
        trackDrag(e, (ev) => set((bottom - ev.clientY) / total));
      }}
      onDoubleClick={() => set(DEFAULT_TIMELINE_SHARE[kind])}
      onKeyDown={(e) => {
        const next =
          e.key === 'ArrowUp' ? share + KEY_STEP : e.key === 'ArrowDown' ? share - KEY_STEP : e.key === 'Home' ? DEFAULT_TIMELINE_SHARE[kind] : null;
        if (next === null) return;
        e.preventDefault();
        e.stopPropagation(); // not a frame step / jump to edit
        set(next);
      }}
    >
      {kind === 'mobile' && <span className="h-1 w-10 rounded-full bg-neutral-500 group-active:bg-accent" aria-hidden />}
    </div>
  );
}

/** Follows one pointer drag on the handle (captured, so it keeps tracking outside it). */
function trackDrag(e: ReactPointerEvent<HTMLElement>, onMove: (ev: PointerEvent) => void) {
  if (e.button !== 0) return;
  e.preventDefault();
  const handle = e.currentTarget;
  handle.setPointerCapture(e.pointerId);
  const onUp = () => {
    handle.removeEventListener('pointermove', onMove);
    handle.removeEventListener('pointerup', onUp);
    handle.removeEventListener('pointercancel', onUp);
  };
  handle.addEventListener('pointermove', onMove);
  handle.addEventListener('pointerup', onUp);
  handle.addEventListener('pointercancel', onUp);
}

/** Narrowest side panel that still fits its controls. */
const MIN_COLUMN_PX = 160;
/** The preview keeps at least this much width between the side panels. */
const MIN_PREVIEW_PX = 280;

/**
 * Desktop handle between the preview and a side column ('start' = Media…, 'end' = Properties).
 * Narrower side panels give the preview more width — with a short timeline, a bigger picture.
 * Follows the editor grid's direction (left-to-right in both languages, see App).
 */
export function ColumnSplitter({ column, container }: { column: Column; container: RefObject<HTMLElement | null> }) {
  const { t } = useTranslation();
  const shares = useColumnShare();
  const share = shares[column];

  const set = (s: number) => {
    const total = container.current?.clientWidth ?? 0;
    if (!total) return;
    const other = column === 'start' ? shares.end : shares.start;
    const max = Math.max(0, 1 - Math.max(other, MIN_COLUMN_PX / total) - MIN_PREVIEW_PX / total);
    setColumnShare(column, Math.max(MIN_COLUMN_PX / total, Math.min(max, s)));
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={t(column === 'start' ? 'panels.resizeStart' : 'panels.resizeEnd')}
      aria-valuenow={Math.round(share * 100)}
      tabIndex={0}
      data-testid={`column-splitter-${column}`}
      className="cursor-col-resize touch-none rounded-full bg-transparent select-none hover:bg-accent/60"
      onPointerDown={(e) => {
        const el = container.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const rtl = getComputedStyle(el).direction === 'rtl';
        // Width of this column = distance from its outer edge of the editor to the pointer.
        const fromLeft = (column === 'start') !== rtl;
        trackDrag(e, (ev) => set((fromLeft ? ev.clientX - rect.left : rect.right - ev.clientX) / rect.width));
      }}
      onDoubleClick={() => set(DEFAULT_COLUMN_SHARE[column])}
      onKeyDown={(e) => {
        const rtl = getComputedStyle(container.current ?? e.currentTarget).direction === 'rtl';
        // Arrow toward the column's own side shrinks it.
        const towardStart = rtl ? 'ArrowRight' : 'ArrowLeft';
        const towardEnd = rtl ? 'ArrowLeft' : 'ArrowRight';
        const grow = column === 'start' ? towardEnd : towardStart;
        const shrink = column === 'start' ? towardStart : towardEnd;
        const next = e.key === grow ? share + KEY_STEP / 2 : e.key === shrink ? share - KEY_STEP / 2 : e.key === 'Home' ? DEFAULT_COLUMN_SHARE[column] : null;
        if (next === null) return;
        e.preventDefault();
        e.stopPropagation(); // not a frame step
        set(next);
      }}
    />
  );
}
