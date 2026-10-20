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

export interface Transform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  crop?: Rect;
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
