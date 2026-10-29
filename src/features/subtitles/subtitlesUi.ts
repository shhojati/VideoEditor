import { create } from 'zustand';
import { useMobileUi } from '../../app/layout';
import type { ID } from '../../model/types';

export type PanelTab = 'media' | 'subtitles' | 'fx' | 'assets' | 'templates';
/** The Subtitles tab's views: the cue editor, or editing the video by its words. */
export type SubtitlesView = 'subtitles' | 'transcript';
/** The Effects tab's views. */
export type FxView = 'effects' | 'transitions' | 'filters';
/** The Assets tab's server libraries. */
export type AssetsKind = 'stickers' | 'sounds' | 'backgrounds' | 'overlays';
/** The Templates tab's views. */
export type TemplatesView = 'templates' | 'layouts';

/** UI state for the left panel tabs and the subtitle editor. */
export const useSubtitlesUi = create<{
  tab: PanelTab;
  subtitlesView: SubtitlesView;
  fxView: FxView;
  assetsKind: AssetsKind;
  templatesView: TemplatesView;
  activeTrackId: ID | null;
  /** Cue whose text box should take focus (set by double-clicking a cue on the timeline). */
  focusCueId: ID | null;
}>()(() => ({
  tab: 'media',
  subtitlesView: 'subtitles',
  fxView: 'effects',
  assetsKind: 'stickers',
  templatesView: 'templates',
  activeTrackId: null,
  focusCueId: null,
}));

/** Every pane of the left panel, by name: a top-level tab or one view inside it. */
export type Pane = 'media' | SubtitlesView | FxView | AssetsKind | TemplatesView;

/** Show a pane: its tab, the view inside it, and (on a phone) the panel sheet. */
export function openPane(pane: Pane) {
  const set = useSubtitlesUi.setState;
  switch (pane) {
    case 'media':
      set({ tab: 'media' });
      break;
    case 'subtitles':
    case 'transcript':
      set({ tab: 'subtitles', subtitlesView: pane });
      break;
    case 'effects':
    case 'transitions':
    case 'filters':
      set({ tab: 'fx', fxView: pane });
      break;
    case 'stickers':
    case 'sounds':
    case 'backgrounds':
    case 'overlays':
      set({ tab: 'assets', assetsKind: pane });
      break;
    case 'templates':
    case 'layouts':
      set({ tab: 'templates', templatesView: pane });
      break;
  }
  useMobileUi.setState({ sheet: 'panels' });
}

/** Open the Subtitles tab on this cue's track and focus its text. */
export const editCueText = (trackId: ID, cueId: ID) => {
  useSubtitlesUi.setState({ tab: 'subtitles', subtitlesView: 'subtitles', activeTrackId: trackId, focusCueId: cueId });
  useMobileUi.setState({ sheet: 'panels' });
};
