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
  align: 'left' | 'center' | 'right';
  rtl: boolean;
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

export interface SubtitleStyle {
  fontFamily: string;
  fontSize: number;
  color: string;
  bgColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  position: 'bottom' | 'middle' | 'top';
  marginY: number;
  maxWidthPct: number;
  highlightActiveWord?: boolean;
}

export interface Cue {
  id: ID;
  start: number;
  end: number;
  text: string;
}

export interface SubtitleTrack {
  id: ID;
  language: string;
  rtl: boolean;
  style: SubtitleStyle;
  cues: Cue[];
}
