import { applyPatches, enablePatches, produceWithPatches, type Patch } from 'immer';

enablePatches();

export interface HistoryEntry {
  label: string;
  patches: Patch[];
  inverse: Patch[];
  /** Consecutive edits with the same key (e.g. one slider drag) collapse into one undo step. */
  mergeKey?: string;
  time: number;
}

export interface History<T> {
  present: T;
  past: HistoryEntry[];
  future: HistoryEntry[];
}

export const HISTORY_LIMIT = 200;
export const MERGE_WINDOW_MS = 1000;

export interface EditOptions {
  mergeKey?: string;
  now?: number;
}

export function createHistory<T>(present: T): History<T> {
  return { present, past: [], future: [] };
}

/** Apply `recipe` to the present state and record it as an undoable step. No-op edits are not recorded. */
export function edit<T>(h: History<T>, label: string, recipe: (draft: T) => void, opts: EditOptions = {}): History<T> {
  // Discard the recipe's return value: Immer treats a returned value as a replacement document,
  // and arrow shorthands like `(p) => Object.assign(p.x, y)` would otherwise throw.
  const [next, patches, inverse] = produceWithPatches(h.present, (draft) => {
    recipe(draft as T);
  });
  if (patches.length === 0) return h;
  const now = opts.now ?? Date.now();
  const last = h.past[h.past.length - 1];
  if (opts.mergeKey && last?.mergeKey === opts.mergeKey && now - last.time < MERGE_WINDOW_MS) {
    const merged: HistoryEntry = {
      ...last,
      patches: [...last.patches, ...patches],
      inverse: [...inverse, ...last.inverse],
      time: now,
    };
    return { present: next as T, past: [...h.past.slice(0, -1), merged], future: [] };
  }
  const entry: HistoryEntry = { label, patches, inverse, mergeKey: opts.mergeKey, time: now };
  return { present: next as T, past: [...h.past, entry].slice(-HISTORY_LIMIT), future: [] };
}

export function undo<T>(h: History<T>): History<T> {
  const entry = h.past[h.past.length - 1];
  if (!entry) return h;
  return {
    present: applyPatches(h.present as object, entry.inverse) as T,
    past: h.past.slice(0, -1),
    future: [entry, ...h.future],
  };
}

export function redo<T>(h: History<T>): History<T> {
  const entry = h.future[0];
  if (!entry) return h;
  return {
    present: applyPatches(h.present as object, entry.patches) as T,
    past: [...h.past, { ...entry, mergeKey: undefined }],
    future: h.future.slice(1),
  };
}
