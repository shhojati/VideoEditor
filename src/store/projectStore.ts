import { create } from 'zustand';
import { normalizeTransitions } from '../model/transitions';
import type { Project } from '../model/types';
import * as H from './history';

interface ProjectState {
  history: H.History<Project> | null;
  /** Replace the open project (open/new). Clears undo history. */
  load: (project: Project) => void;
  close: () => void;
  /** Every change to the project document goes through here so it is undoable. */
  edit: (label: string, recipe: (draft: Project) => void, opts?: H.EditOptions) => void;
  undo: () => void;
  redo: () => void;
}

export const useProjectStore = create<ProjectState>()((set) => ({
  history: null,
  load: (project) => set({ history: H.createHistory(project) }),
  close: () => set({ history: null }),
  edit: (label, recipe, opts) =>
    set((s) =>
      s.history
        ? {
            // Every edit ends with the transition clean-up, so moves/trims/deletes never leave a
            // transition on clips that no longer touch.
            history: H.edit(s.history, label, (d) => {
              recipe(d);
              normalizeTransitions(d);
            }, opts),
          }
        : s,
    ),
  undo: () => set((s) => (s.history ? { history: H.undo(s.history) } : s)),
  redo: () => set((s) => (s.history ? { history: H.redo(s.history) } : s)),
}));

// Selectors
export const useProject = () => useProjectStore((s) => s.history?.present ?? null);
export const useCanUndo = () => useProjectStore((s) => (s.history?.past.length ?? 0) > 0);
export const useCanRedo = () => useProjectStore((s) => (s.history?.future.length ?? 0) > 0);
export const useUndoLabel = () => useProjectStore((s) => s.history?.past.at(-1)?.label);
export const useRedoLabel = () => useProjectStore((s) => s.history?.future[0]?.label);
