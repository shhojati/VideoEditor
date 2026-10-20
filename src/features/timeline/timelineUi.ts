import { create } from 'zustand';
import type { ID } from '../../model/types';

export const HEADER_WIDTH = 176;
export const TRACK_HEIGHT = 52;
export const RULER_HEIGHT = 26;
export const MIN_PPS = 1;
export const MAX_PPS = 500;
/** Snap distance in screen pixels. */
export const SNAP_PX = 8;

/** Where clips would land if the current drag ended now. */
export interface DragPreview {
  /** Overrides for clips being moved/trimmed. */
  clips: Record<ID, { trackId: ID; start: number; duration: number }>;
  /** A clip being dropped from the media bin; trackId null = a new track. */
  asset?: { assetId: ID; trackId: ID | null; start: number; duration: number };
  valid: boolean;
  /** Snap guide line (s). */
  guide?: number;
}

interface TimelineUiState {
  /** Zoom: pixels per second. */
  pps: number;
  scrollX: number;
  viewportWidth: number;
  selection: ID[];
  snapping: boolean;
  drag: DragPreview | null;
}

export const useTimelineUi = create<TimelineUiState>()(() => ({
  pps: 40,
  scrollX: 0,
  viewportWidth: 800,
  selection: [],
  snapping: true,
  drag: null,
}));

export const clampPps = (pps: number) => Math.min(MAX_PPS, Math.max(MIN_PPS, pps));

export function select(ids: ID[], mode: 'replace' | 'toggle' = 'replace') {
  useTimelineUi.setState((s) => {
    if (mode === 'replace') return { selection: ids };
    const set = new Set(s.selection);
    for (const id of ids) {
      if (set.has(id)) set.delete(id);
      else set.add(id);
    }
    return { selection: [...set] };
  });
}

/** Asset currently being dragged from the media bin (dataTransfer is unreadable during dragover). */
export const assetDrag: { assetId: ID | null } = { assetId: null };
