// The project document. Plain, serializable JSON: everything that affects the rendered output lives here.

export type ID = string;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
  sampleRate: number;
}

export interface Project {
  id: ID;
  name: string;
  version: number;
  settings: ProjectSettings;
  assets: Record<ID, Asset>;
  /** Ordered bottom -> top. */
  tracks: Track[];
  subtitleTracks: SubtitleTrack[];
}

export type AssetKind = 'video' | 'audio' | 'image';

export interface Asset {
  id: ID;
  kind: AssetKind;
  name: string;
  duration?: number;
  width?: number;
  height?: number;
  /** Average frame rate of the video track. */
  fps?: number;
  /** False when the file has no (decodable) audio track. */
  hasAudio?: boolean;
  /** Bytes; used to sanity-check a relinked file. */
  size?: number;
  mimeType?: string;
  codecs?: { video?: string; audio?: string };
  /** How to re-open the media: a copy in OPFS, or a File System Access handle stored in IndexedDB. */
  fileRef: { opfsPath?: string; handleKey?: string };
}

export type TrackKind = 'video' | 'audio' | 'text';

export interface Track {
  id: ID;
  kind: TrackKind;
  muted: boolean;
  locked: boolean;
  clips: Clip[];
}

/**
 * Placement of a visual clip on the canvas. The (cropped) media is first fitted to the canvas
 * (`fit`, default 'contain'), then scaled, rotated about its centre and offset.
 */
export interface Transform {
  /** Offset of the centre, as a fraction of canvas width (0 = centred, 0.5 = right edge). */
  x: number;
  /** Offset of the centre, as a fraction of canvas height (0 = centred, 0.5 = bottom edge). */
  y: number;
  scale: number;
  /** Degrees, clockwise. */
  rotation: number;
  opacity: number;
  /** Visible part of the source, as fractions (0..1) of its display size. */
  crop?: Rect;
  fit?: 'contain' | 'cover';
}

export interface ClipAudio {
  volume: number;
  fadeIn: number;
  fadeOut: number;
}

export interface TextProps {
  content: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  color: string;
  strokeColor?: string;
  strokeWidth?: number;
  bgColor?: string;
  shadowColor?: string;
  /** Blur radius in canvas pixels at scale 1. */
  shadowBlur?: number;
  align: 'left' | 'center' | 'right';
  rtl: boolean;
  /** Lines wrap at this fraction of the canvas width (default 0.9). */
  maxWidth?: number;
  fadeIn: number;
  fadeOut: number;
}

export interface Clip {
  id: ID;
  assetId?: ID;
  /** Position on the timeline (s). */
  start: number;
  /** Length on the timeline (s). */
  duration: number;
  /** Offset into the source (s). */
  inPoint: number;
  /** 1 = normal. */
  speed: number;
  transform: Transform;
  audio: ClipAudio;
  text?: TextProps;
}

/**
 * Sizes are in pixels of a 1080-pixel short side, so a style looks the same at any resolution or
 * aspect ratio (it is scaled by min(width, height) / 1080 when drawn).
 */
export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  fontWeight?: number;
  color: string;
  /** Box behind each line. */
  bgColor?: string;
  /** 0..1, default 0.6. */
  bgOpacity?: number;
  strokeColor?: string;
  strokeWidth?: number;
  position: 'bottom' | 'middle' | 'top';
  /** Distance from the top/bottom edge. */
  marginY: number;
  /** Line width limit, percent of the frame width. */
  maxWidthPct: number;
  /** Show digits as Persian (۱۲۳) or Latin (123), or leave them as typed. */
  digits?: 'keep' | 'persian' | 'latin';
  highlightActiveWord?: boolean;
}

export interface Cue {
  id: ID;
  start: number;
  end: number;
  text: string;
  /** Set by auto-generation for cues worth a second look; cleared when the text is edited. */
  flag?: 'review';
}

export interface SubtitleTrack {
  id: ID;
  language: string;
  rtl: boolean;
  /** Hidden tracks are neither previewed nor burned into the export. */
  hidden?: boolean;
  style: SubtitleStyle;
  cues: Cue[];
}
