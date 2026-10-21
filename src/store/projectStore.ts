import { create } from 'zustand';
import { normalizeMotion } from '../engine/render/motion';
import { normalizeSequences, openSequence, sequenceView } from '../model/sequences';
import { normalizeTransitions } from '../model/transitions';
import type { ID, Project } from '../model/types';
import * as H from './history';

/** One level of compound clips the user has opened (the timeline shows its sequence). */
export interface EditStep {
  clipId: ID;
  sequenceId: ID;
  /** The playhead outside, to go back to. */
  outerTime: number;
}

interface ProjectState {
  history: H.History<Project> | null;
  /** Opened compound clips, outermost first; empty = the main timeline. Not part of undo. */
  editPath: EditStep[];
  /** Replace the open project (open/new). Clears undo history. */
  load: (project: Project) => void;
  close: () => void;
  /**
   * Every change to the project document goes through here so it is undoable. Inside a compound
   * clip, the recipe sees that sequence as the project's tracks (no subtitles or markers there), so
   * every editing operation works inside compounds unchanged.
   */
  edit: (label: string, recipe: (draft: Project) => void, opts?: H.EditOptions) => void;
  undo: () => void;
  redo: () => void;
}

/** Clean-up after every edit, on the main timeline and inside every compound. */
function normalize(d: Project) {
  normalizeSequences(d);
  for (const p of [d, ...Object.keys(d.sequences ?? {}).map((id) => sequenceView(d, id))]) {
    normalizeTransitions(p);
    normalizeMotion(p);
  }
}

/** Drop opened compounds that no longer exist (after undo, or a delete). */
const reconcile = (path: EditStep[], p: Project | undefined) => {
  const i = path.findIndex((s) => !p?.sequences?.[s.sequenceId]);
  return i < 0 ? path : path.slice(0, i);
};

export const useProjectStore = create<ProjectState>()((set) => ({
  history: null,
  editPath: [],
  load: (project) => set({ history: H.createHistory(project), editPath: [] }),
  close: () => set({ history: null, editPath: [] }),
  edit: (label, recipe, opts) =>
    set((s) => {
      if (!s.history) return s;
      const seqId = openSequence(s.editPath);
      const history = H.edit(
        s.history,
        label,
        (d) => {
          const seq = seqId ? d.sequences?.[seqId] : undefined;
          if (seq) {
            // Swap the sequence in as the timeline for the recipe, then back.
            const outer = { tracks: d.tracks, subtitleTracks: d.subtitleTracks, markers: d.markers };
            d.tracks = seq.tracks;
            d.subtitleTracks = [];
            delete d.markers;
            try {
              recipe(d);
            } finally {
              seq.tracks = d.tracks;
              d.tracks = outer.tracks;
              d.subtitleTracks = outer.subtitleTracks;
              if (outer.markers) d.markers = outer.markers;
              else delete d.markers;
            }
          } else recipe(d);
          normalize(d);
        },
        opts,
      );
      return { history, editPath: reconcile(s.editPath, history.present) };
    }),
  undo: () =>
    set((s) => {
      if (!s.history) return s;
      const history = H.undo(s.history);
      return { history, editPath: reconcile(s.editPath, history.present) };
    }),
  redo: () =>
    set((s) => {
      if (!s.history) return s;
      const history = H.redo(s.history);
      return { history, editPath: reconcile(s.editPath, history.present) };
    }),
}));

const views = new WeakMap<Project, Map<ID, Project>>();

/** The project as the editor shows it: inside an opened compound, that sequence is the timeline. */
export function viewOf(p: Project | null | undefined, path: readonly EditStep[]): Project | null {
  if (!p) return null;
  const seqId = openSequence(path);
  if (!seqId || !p.sequences?.[seqId]) return p;
  let byId = views.get(p);
  if (!byId) views.set(p, (byId = new Map()));
  let v = byId.get(seqId);
  if (!v) byId.set(seqId, (v = sequenceView(p, seqId)));
  return v;
}

/** What editing code works on (the opened compound's sequence, or the main timeline). */
export const currentProject = () => {
  const s = useProjectStore.getState();
  return viewOf(s.history?.present, s.editPath);
};
/** The whole document (saving, export, project files). */
export const rootProject = () => useProjectStore.getState().history?.present ?? null;

// Selectors
export const useProject = () => useProjectStore((s) => viewOf(s.history?.present, s.editPath));
export const useRootProject = () => useProjectStore((s) => s.history?.present ?? null);
export const useCanUndo = () => useProjectStore((s) => (s.history?.past.length ?? 0) > 0);
export const useCanRedo = () => useProjectStore((s) => (s.history?.future.length ?? 0) > 0);
export const useUndoLabel = () => useProjectStore((s) => s.history?.past.at(-1)?.label);
export const useRedoLabel = () => useProjectStore((s) => s.history?.future[0]?.label);
