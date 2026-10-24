// Library panes (Stickers, Sound effects, Overlays, Backgrounds): listing the server folders, and turning an
// item into a project asset — downloaded and imported once, then reused (matched by library path).
import { create } from 'zustand';
import { fetchLibraryFile, LibraryUnavailable, listLibrary, type LibraryItem } from '../../lib/library';
import type { ID, LibraryKind } from '../../model/types';
import { currentProject } from '../../store/projectStore';
import { importFileAs } from '../media-bin/mediaService';
import { addAssetAtPlayhead, addBackgroundAtPlayhead, placeAssetAt } from '../timeline/interactions';
import { assetDrag } from '../timeline/timelineUi';

export interface LibraryListing {
  status: 'loading' | 'ready' | 'unavailable' | 'error';
  items: LibraryItem[];
  error?: string;
}

interface LibraryState {
  lists: Partial<Record<LibraryKind, LibraryListing>>;
  /** Item urls being downloaded/imported. */
  busy: Record<string, true>;
}

export const useLibrary = create<LibraryState>()(() => ({ lists: {}, busy: {} }));

export async function loadLibrary(kind: LibraryKind, force = false) {
  const current = useLibrary.getState().lists[kind];
  if (current && !force && current.status !== 'error') return;
  const set = (l: LibraryListing) => useLibrary.setState((s) => ({ lists: { ...s.lists, [kind]: l } }));
  set({ status: 'loading', items: current?.items ?? [] });
  try {
    set({ status: 'ready', items: await listLibrary(kind) });
  } catch (e) {
    if (e instanceof LibraryUnavailable) set({ status: 'unavailable', items: [] });
    else set({ status: 'error', items: [], error: e instanceof Error ? e.message : String(e) });
  }
}

const inFlight = new Map<string, Promise<ID | null>>();

const findAsset = (item: LibraryItem) => {
  const p = currentProject();
  return p && Object.values(p.assets).find((a) => a.library?.kind === item.kind && a.library.path === item.path)?.id;
};

/** The project asset for a library item, downloading and importing it the first time. */
export function ensureLibraryAsset(item: LibraryItem): Promise<ID | null> {
  const existing = findAsset(item);
  if (existing) return Promise.resolve(existing);
  let p = inFlight.get(item.url);
  if (!p) {
    useLibrary.setState((s) => ({ busy: { ...s.busy, [item.url]: true } }));
    p = fetchLibraryFile(item)
      .then((file) => importFileAs(file, { library: { kind: item.kind, path: item.path }, name: item.name }))
      .finally(() => {
        inFlight.delete(item.url);
        useLibrary.setState((s) => {
          const busy = { ...s.busy };
          delete busy[item.url];
          return { busy };
        });
      });
    inFlight.set(item.url, p);
  }
  return p;
}

/**
 * Click: add at the playhead (stickers/overlays on a free video track, sounds on an audio track,
 * backgrounds on the bottom video track).
 */
export async function addLibraryItem(item: LibraryItem) {
  const id = await ensureLibraryAsset(item);
  if (!id) return;
  if (item.kind === 'backgrounds') addBackgroundAtPlayhead(id);
  else addAssetAtPlayhead(id);
}

/**
 * Drag start: once the asset exists the timeline shows the normal drop preview; dropped before
 * that, the clip is placed where it was dropped as soon as the file is in.
 */
export function startLibraryDrag(item: LibraryItem) {
  const ready = findAsset(item);
  if (ready) {
    assetDrag.assetId = ready;
    return;
  }
  const download = ensureLibraryAsset(item);
  const pending = (trackId: ID | null, time: number) => void download.then((id) => id && placeAssetAt(id, trackId, time));
  assetDrag.pending = pending;
  void download.then((id) => {
    if (id && assetDrag.pending === pending) {
      assetDrag.assetId = id;
      assetDrag.pending = null;
    }
  });
}

export function endLibraryDrag() {
  assetDrag.assetId = null;
  // A drop already consumed `pending`; otherwise the drag was cancelled.
  assetDrag.pending = null;
}
