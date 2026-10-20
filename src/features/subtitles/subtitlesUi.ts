import { create } from 'zustand';
import { useMobileUi } from '../../app/layout';
import type { ID } from '../../model/types';

/** UI state for the left panel (Media / Subtitles tabs) and the subtitle editor. */
export const useSubtitlesUi = create<{
  tab: 'media' | 'subtitles' | 'transitions';
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
