import { create } from 'zustand';
import type { Project } from '../model/types';
import { saveProject } from './persistence';
import { useProjectStore } from './projectStore';

export type SaveStatus = 'saved' | 'pending' | 'saving' | 'error';

export const useSaveStatus = create<{ status: SaveStatus; error?: string }>()(() => ({ status: 'saved' }));

export const AUTOSAVE_DELAY_MS = 400;

/**
 * Persist the open project shortly after every change. Returns an unsubscribe function.
 * Because the store is immutable, a changed `present` reference means the document changed.
 */
export function startAutosave(delay = AUTOSAVE_DELAY_MS): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queued: Project | null = null;

  const flush = async () => {
    timer = undefined;
    const project = queued;
    queued = null;
    if (!project) return;
    useSaveStatus.setState({ status: 'saving', error: undefined });
    try {
      await saveProject(project);
      useSaveStatus.setState({ status: queued ? 'pending' : 'saved' });
    } catch (e) {
      useSaveStatus.setState({ status: 'error', error: String(e) });
    }
  };

  const unsubscribe = useProjectStore.subscribe((s, prev) => {
    const next = s.history?.present;
    if (!next || next === prev.history?.present) return;
    // Loading a different project is not an edit; it is already stored.
    if (prev.history?.present.id !== next.id) return;
    queued = next;
    useSaveStatus.setState({ status: 'pending' });
    clearTimeout(timer);
    timer = setTimeout(flush, delay);
  });

  const onHide = () => {
    if (document.visibilityState === 'hidden' && timer) {
      clearTimeout(timer);
      void flush();
    }
  };
  document.addEventListener('visibilitychange', onHide);

  return () => {
    unsubscribe();
    document.removeEventListener('visibilitychange', onHide);
    clearTimeout(timer);
  };
}
