import { create } from 'zustand';
import type { ID } from '../../model/types';

/** UI state for the left panel (Media / Subtitles tabs) and the subtitle editor. */
export const useSubtitlesUi = create<{ tab: 'media' | 'subtitles'; activeTrackId: ID | null }>()(() => ({
  tab: 'media',
  activeTrackId: null,
}));
