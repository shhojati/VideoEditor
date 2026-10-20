import type { ProjectSettings } from '../../model/types';

export type ExportQuality = 'low' | 'medium' | 'high';

export interface ExportSettings {
  /** Short side of the output: 720p or 1080p, keeping the project's aspect ratio. */
  resolution: 720 | 1080;
  fps: 24 | 25 | 30 | 50 | 60;
  quality: ExportQuality;
  /** Burn subtitle tracks into the picture. */
  burnSubtitles: boolean;
  /** Also save each visible subtitle track as .srt next to the video. */
  srt: boolean;
}

export const AUDIO_RATE = 48_000;
export const AUDIO_BITRATE = 160_000;

/** Output size: short side = resolution, aspect kept, both sides even (H.264 needs even sizes). */
export function outputSize(project: Pick<ProjectSettings, 'width' | 'height'>, resolution: number) {
  const scale = resolution / Math.min(project.width, project.height);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(project.width * scale), height: even(project.height * scale) };
}

/** H.264 bits per second for a size/fps/quality; 1080p30 medium ≈ 8 Mbps. */
export function videoBitrate(width: number, height: number, fps: number, quality: ExportQuality): number {
  const perPixelFrame = { low: 0.06, medium: 0.12, high: 0.2 }[quality];
  return Math.round(width * height * Math.min(fps, 60) * perPixelFrame);
}

export function frameCount(duration: number, fps: number) {
  return Math.max(1, Math.ceil(duration * fps - 1e-6));
}

/** Rough output size in bytes (for the dialog). */
export function estimateBytes(duration: number, width: number, height: number, fps: number, quality: ExportQuality) {
  return ((videoBitrate(width, height, fps, quality) + AUDIO_BITRATE) / 8) * duration;
}
