import { useSyncExternalStore } from 'react';
import { create } from 'zustand';

/** Phones (and narrow windows) get the stacked layout; matches Tailwind's `md` breakpoint. */
const MOBILE_QUERY = '(max-width: 767px)';

const mql = () => window.matchMedia(MOBILE_QUERY);
const subscribe = (cb: () => void) => {
  const m = mql();
  m.addEventListener('change', cb);
  return () => m.removeEventListener('change', cb);
};

export const useIsMobile = () => useSyncExternalStore(subscribe, () => mql().matches);

/**
 * Mobile only: the sheet that covers the timeline. 'panels' shows the left-panel tab
 * (Media / Subtitles / Transitions, from useSubtitlesUi.tab); null = timeline visible.
 */
export const useMobileUi = create<{ sheet: 'panels' | 'inspector' | null }>()(() => ({ sheet: null }));

/** Share of the editor height given to the timeline, per layout; remembered on this device. */
export type LayoutKind = 'desktop' | 'mobile';
export const DEFAULT_TIMELINE_SHARE: Record<LayoutKind, number> = { desktop: 0.34, mobile: 0.5 };
const shareKey = (kind: LayoutKind) => `videoEditor.timelineShare.${kind}`;

function loadShare(kind: LayoutKind) {
  try {
    const v = Number(localStorage.getItem(shareKey(kind)));
    return v > 0 && v < 1 ? v : DEFAULT_TIMELINE_SHARE[kind];
  } catch {
    return DEFAULT_TIMELINE_SHARE[kind];
  }
}

export const useTimelineShare = create<Record<LayoutKind, number>>()(() => ({
  desktop: loadShare('desktop'),
  mobile: loadShare('mobile'),
}));

export function setTimelineShare(kind: LayoutKind, share: number) {
  useTimelineShare.setState({ [kind]: share });
  try {
    localStorage.setItem(shareKey(kind), String(share));
  } catch {
    // Private mode / blocked storage: the size just is not remembered.
  }
}

/** Desktop side columns (Media… / Properties) as shares of the editor width; remembered too. */
export type Column = 'start' | 'end';
export const DEFAULT_COLUMN_SHARE: Record<Column, number> = { start: 0.2, end: 0.22 };
const columnKey = (col: Column) => `videoEditor.columnShare.${col}`;

function loadColumn(col: Column) {
  try {
    const v = Number(localStorage.getItem(columnKey(col)));
    return v > 0 && v < 1 ? v : DEFAULT_COLUMN_SHARE[col];
  } catch {
    return DEFAULT_COLUMN_SHARE[col];
  }
}

export const useColumnShare = create<Record<Column, number>>()(() => ({
  start: loadColumn('start'),
  end: loadColumn('end'),
}));

export function setColumnShare(col: Column, share: number) {
  useColumnShare.setState({ [col]: share });
  try {
    localStorage.setItem(columnKey(col), String(share));
  } catch {
    // Not remembered; see setTimelineShare.
  }
}
