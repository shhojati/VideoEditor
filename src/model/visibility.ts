// After Effects' eye and solo switches on timeline tracks. A hidden track draws nothing; while any
// track is soloed, only soloed tracks draw and sound. Both apply to the preview and the export.
import type { Track } from './types';

type Tracks = { tracks: readonly Pick<Track, 'solo'>[] };

/** True while at least one track is soloed. */
export const soloActive = (p: Tracks) => p.tracks.some((t) => t.solo);

/** The track's pictures are drawn (eye on, and soloed or nothing soloed). */
export const trackShows = (p: Tracks, track: Pick<Track, 'hidden' | 'solo'>) => !track.hidden && (!!track.solo || !soloActive(p));

/** The track's sound plays (not muted, and soloed or nothing soloed). */
export const trackSounds = (p: Tracks, track: Pick<Track, 'muted' | 'solo'>) => !track.muted && (!!track.solo || !soloActive(p));
