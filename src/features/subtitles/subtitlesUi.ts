import { create } from 'zustand';
import { useMobileUi } from '../../app/layout';
import type { ID } from '../../model/types';

export type PanelTab = 'media' | 'subtitles' | 'effects' | 'assets' | 'transitions' | 'overlays' | 'filters' | 'layouts' | 'templates';
/** The Subtitles tab's views: the cue editor, or editing the video by its words. */
export type SubtitlesView = 'subtitles' | 'transcript';
/** The Assets tab's server libraries. */
export type AssetsKind = 'stickers' | 'sounds' | 'backgrounds';

/** UI state for the left panel tabs and the subtitle editor. */
export const useSubtitlesUi = create<{
  tab: PanelTab;
  subtitlesView: SubtitlesView;
  assetsKind: AssetsKind;
  activeTrackId: ID | null;
  /** Cue whose text box should take focus (set by double-clicking a cue on the timeline). */
  focusCueId: ID | null;
}>()(() => ({
  tab: 'media',
  subtitlesView: 'subtitles',
  assetsKind: 'stickers',
  activeTrackId: null,
  focusCueId: null,
}));

/** Open the Subtitles tab on this cue's track and focus its text. */
export const editCueText = (trackId: ID, cueId: ID) => {
  useSubtitlesUi.setState({ tab: 'subtitles', subtitlesView: 'subtitles', activeTrackId: trackId, focusCueId: cueId });
  useMobileUi.setState({ sheet: 'panels' });
};
