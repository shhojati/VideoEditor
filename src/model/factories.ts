import { CURRENT_VERSION } from './migrations';
import { SUBTITLE_PRESETS } from './subtitlePresets';
import type { ID, Platform, Project, ProjectSettings, SubtitleStyle, SubtitleTrack, Track, TrackKind } from './types';

export const newId = (): ID => crypto.randomUUID();

export type AspectPreset = '16:9' | '9:16' | '1:1' | '4:5' | '5:4';

/** Canvas size for each aspect preset at 1080p-class resolution. */
export const ASPECT_PRESETS: Record<AspectPreset, { width: number; height: number }> = {
  '16:9': { width: 1920, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
  '1:1': { width: 1080, height: 1080 },
  '4:5': { width: 1080, height: 1350 },
  '5:4': { width: 1350, height: 1080 },
};

export function aspectOf(settings: Pick<ProjectSettings, 'width' | 'height'>): AspectPreset | undefined {
  return (Object.keys(ASPECT_PRESETS) as AspectPreset[]).find(
    (k) => ASPECT_PRESETS[k].width === settings.width && ASPECT_PRESETS[k].height === settings.height,
  );
}

export function createTrack(kind: TrackKind): Track {
  return { id: newId(), kind, muted: false, locked: false, clips: [] };
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyle = SUBTITLE_PRESETS.classic;

export function createSubtitleTrack(language = 'fa'): SubtitleTrack {
  const rtl = ['fa', 'ar', 'he', 'ur'].includes(language);
  return { id: newId(), language, rtl, style: { ...DEFAULT_SUBTITLE_STYLE }, cues: [] };
}

export function createProject(name: string, aspect: AspectPreset = '16:9', platform?: Platform): Project {
  return {
    id: newId(),
    name,
    version: CURRENT_VERSION,
    settings: { ...ASPECT_PRESETS[aspect], fps: 30, sampleRate: 48_000, ...(platform && { platform }) },
    assets: {},
    // Bottom -> top, so the timeline shows video above audio.
    tracks: [createTrack('audio'), createTrack('video')],
    subtitleTracks: [],
  };
}
