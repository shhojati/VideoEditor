import type { SubtitleStyle } from './types';

export type SubtitlePresetId = 'classic' | 'boxed' | 'outline' | 'social';

/** Style presets (plan §6b). Sizes are for a 1080-pixel short side. */
export const SUBTITLE_PRESETS: Record<SubtitlePresetId, SubtitleStyle> = {
  classic: {
    fontFamily: 'Vazirmatn',
    fontSize: 48,
    fontWeight: 600,
    color: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 5,
    position: 'bottom',
    marginY: 60,
    maxWidthPct: 80,
    digits: 'keep',
  },
  boxed: {
    fontFamily: 'Vazirmatn',
    fontSize: 44,
    fontWeight: 500,
    color: '#ffffff',
    bgColor: '#000000',
    bgOpacity: 0.65,
    position: 'bottom',
    marginY: 56,
    maxWidthPct: 80,
    digits: 'keep',
  },
  outline: {
    fontFamily: 'Vazirmatn',
    fontSize: 52,
    fontWeight: 800,
    color: '#ffe14d',
    strokeColor: '#000000',
    strokeWidth: 8,
    position: 'bottom',
    marginY: 70,
    maxWidthPct: 80,
    digits: 'keep',
  },
  // Short-form vertical video: large, bold, in the middle third.
  social: {
    fontFamily: 'Lalezar',
    fontSize: 72,
    fontWeight: 400,
    color: '#ffffff',
    strokeColor: '#000000',
    strokeWidth: 10,
    position: 'middle',
    marginY: 0,
    maxWidthPct: 85,
    digits: 'keep',
  },
};

/** Which preset (if any) a style currently equals, ignoring the digits setting. */
export function presetOf(style: SubtitleStyle): SubtitlePresetId | undefined {
  const norm = (s: SubtitleStyle) => JSON.stringify({ ...s, digits: undefined });
  return (Object.keys(SUBTITLE_PRESETS) as SubtitlePresetId[]).find(
    (id) => norm(SUBTITLE_PRESETS[id]) === norm(style),
  );
}
