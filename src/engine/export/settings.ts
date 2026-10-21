import type { ProjectSettings } from '../../model/types';

export type ExportFormat = 'mp4' | 'mov' | 'webm' | 'avi' | 'mp3' | 'gif' | 'png' | 'jpg';
export type ExportQuality = 'low' | 'medium' | 'high' | 'custom';
/** PNG/JPG: one image of the frame under the playhead, or every frame in a ZIP. */
export type ImageMode = 'frame' | 'sequence';
export type ExportResolution = 240 | 360 | 480 | 720 | 1080;
export type ExportFps = 10 | 15 | 24 | 25 | 30 | 50 | 60;

export interface ExportSettings {
  format: ExportFormat;
  /** Short side of the output, keeping the project's aspect ratio. */
  resolution: ExportResolution;
  fps: ExportFps;
  /** Presets derive the video bitrate from size and fps; 'custom' uses `videoBitrate`. */
  quality: ExportQuality;
  /** Video bits per second when quality is 'custom'. */
  videoBitrate: number;
  /** Audio bits per second for AAC, Opus and MP3 (AVI stores PCM). */
  audioBitrate: number;
  imageMode: ImageMode;
  /** Timeline time (s) of the single frame for imageMode 'frame'. */
  frameTime: number;
  /** Burn subtitle tracks into the picture. */
  burnSubtitles: boolean;
  /** Also save each visible subtitle track as .srt next to the video. */
  srt: boolean;
}

export type FormatKind = 'video' | 'audio' | 'gif' | 'image';

export interface FormatInfo {
  kind: FormatKind;
  ext: string;
  mime: string;
  resolutions: readonly ExportResolution[];
  fps: readonly ExportFps[];
}

const VIDEO_RES = [720, 1080] as const;
const VIDEO_FPS = [24, 25, 30, 50, 60] as const;

export const FORMATS: Record<ExportFormat, FormatInfo> = {
  mp4: { kind: 'video', ext: 'mp4', mime: 'video/mp4', resolutions: VIDEO_RES, fps: VIDEO_FPS },
  mov: { kind: 'video', ext: 'mov', mime: 'video/quicktime', resolutions: VIDEO_RES, fps: VIDEO_FPS },
  webm: { kind: 'video', ext: 'webm', mime: 'video/webm', resolutions: VIDEO_RES, fps: VIDEO_FPS },
  avi: { kind: 'video', ext: 'avi', mime: 'video/x-msvideo', resolutions: VIDEO_RES, fps: VIDEO_FPS },
  mp3: { kind: 'audio', ext: 'mp3', mime: 'audio/mpeg', resolutions: [], fps: [] },
  gif: { kind: 'gif', ext: 'gif', mime: 'image/gif', resolutions: [240, 360, 480], fps: [10, 15, 24] },
  png: { kind: 'image', ext: 'png', mime: 'image/png', resolutions: VIDEO_RES, fps: VIDEO_FPS },
  jpg: { kind: 'image', ext: 'jpg', mime: 'image/jpeg', resolutions: VIDEO_RES, fps: VIDEO_FPS },
};

export const EXPORT_FORMATS = Object.keys(FORMATS) as ExportFormat[];

export const AUDIO_RATE = 48_000;
export const AUDIO_BITRATES = [96_000, 128_000, 160_000, 192_000, 256_000, 320_000] as const;
export const AUDIO_BITRATE = 160_000;
/** AVI audio: 16-bit stereo PCM at AUDIO_RATE. */
export const PCM_BITRATE = AUDIO_RATE * 2 * 16;

const nearest = <T extends number>(options: readonly T[], v: number) =>
  options.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));

/** Clamp resolution and fps to what the format offers (e.g. after switching to GIF). */
export function fitToFormat(s: ExportSettings): ExportSettings {
  const f = FORMATS[s.format];
  return {
    ...s,
    resolution: f.resolutions.length ? nearest(f.resolutions, s.resolution) : s.resolution,
    fps: f.fps.length ? nearest(f.fps, s.fps) : s.fps,
  };
}

/** Whether the output carries the mixed audio. */
export const hasAudio = (s: ExportSettings) =>
  FORMATS[s.format].kind === 'video' || FORMATS[s.format].kind === 'audio';
/** Whether the output is a ZIP of images. */
export const isSequence = (s: ExportSettings) =>
  FORMATS[s.format].kind === 'image' && s.imageMode === 'sequence';

export function outputName(base: string, s: ExportSettings) {
  return `${base}.${isSequence(s) ? 'zip' : FORMATS[s.format].ext}`;
}

export function outputMime(s: ExportSettings) {
  return isSequence(s) ? 'application/zip' : FORMATS[s.format].mime;
}

/** Output size: short side = resolution, aspect kept, both sides even (H.264 needs even sizes). */
export function outputSize(project: Pick<ProjectSettings, 'width' | 'height'>, resolution: number) {
  const scale = resolution / Math.min(project.width, project.height);
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  return { width: even(project.width * scale), height: even(project.height * scale) };
}

/** Preset video bits per second for a size/fps/quality; 1080p30 medium ≈ 7.5 Mbps. */
export function videoBitrate(
  width: number,
  height: number,
  fps: number,
  quality: Exclude<ExportQuality, 'custom'>,
): number {
  const perPixelFrame = { low: 0.06, medium: 0.12, high: 0.2 }[quality];
  return Math.round(width * height * Math.min(fps, 60) * perPixelFrame);
}

/** The video bitrate the encoder is given: the preset's, or the typed one. */
export function effectiveVideoBitrate(s: ExportSettings, width: number, height: number) {
  return s.quality === 'custom' ? s.videoBitrate : videoBitrate(width, height, s.fps, s.quality);
}

/** Audio bits per second in the output (0 without audio). */
export function effectiveAudioBitrate(s: ExportSettings) {
  if (!hasAudio(s)) return 0;
  return s.format === 'avi' ? PCM_BITRATE : s.audioBitrate;
}

export function frameCount(duration: number, fps: number) {
  return Math.max(1, Math.ceil(duration * fps - 1e-6));
}

/** Rough output size in bytes (for the dialog). Images and GIF are guesses per pixel. */
export function estimateBytes(s: ExportSettings, duration: number, width: number, height: number) {
  const kind = FORMATS[s.format].kind;
  if (kind === 'video')
    return ((effectiveVideoBitrate(s, width, height) + effectiveAudioBitrate(s)) / 8) * duration;
  if (kind === 'audio') return (s.audioBitrate / 8) * duration;
  const perPixel = s.format === 'gif' ? 0.4 : s.format === 'png' ? 1.5 : 0.25;
  const frames = s.format !== 'gif' && s.imageMode === 'frame' ? 1 : frameCount(duration, s.fps);
  return width * height * perPixel * frames;
}
