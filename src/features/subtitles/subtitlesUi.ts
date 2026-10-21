import { create } from 'zustand';
import { useMobileUi } from '../../app/layout';
import type { ID } from '../../model/types';

export type PanelTab = 'media' | 'subtitles' | 'stickers' | 'sounds' | 'overlays' | 'transitions' | 'effects' | 'filters';

/** UI state for the left panel tabs and the subtitle editor. */
export const useSubtitlesUi = create<{
  tab: PanelTab;
  activeTrackId: ID | null;
  /** Cue whose text box should take focus (set by double-clicking a cue on the timeline). */
  focusCueId: ID | null;
}>()(() => ({
  tab: 'media',
  activeTrackId: null,
  focusCueId: null,
}));

/** Open the Subtitles tab on this cue's track and focus its text. */
export const editCueText = (trackId: ID, cueId: ID) => {
  useSubtitlesUi.setState({ tab: 'subtitles', activeTrackId: trackId, focusCueId: cueId });
  useMobileUi.setState({ sheet: 'panels' });
};
