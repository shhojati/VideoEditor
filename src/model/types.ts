// The project document. Plain, serializable JSON: everything that affects the rendered output lives here.

export type ID = string;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Platform = 'instagramReels' | 'instagramPost' | 'youtube' | 'tiktok';

export interface ProjectSettings {
  width: number;
  height: number;
  fps: number;
  sampleRate: number;
  /** Where the video will be published; sets the length limit the editor warns about. */
  platform?: Platform;
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

/** Server library folders (library/<kind>/…). */
export type LibraryKind = 'stickers' | 'sounds' | 'overlays';

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
  /** Set when the file came from the server's library (Stickers / Sound effects / Overlays panes). */
  library?: { kind: LibraryKind; path: string };
}

/** 'text' tracks hold overlays: text and shape clips (shown as "Overlay" in the UI). */
export type TrackKind = 'video' | 'audio' | 'text';

export interface Track {
  id: ID;
  kind: TrackKind;
  muted: boolean;
  locked: boolean;
  clips: Clip[];
  /** Transitions between touching clips of this track (see model/transitions.ts). */
  transitions?: Transition[];
}

export type TransitionKind =
  | 'crossfade'
  | 'dipBlack'
  | 'dipWhite'
  | 'wipeLeft'
  | 'wipeRight'
  | 'wipeUp'
  | 'wipeDown'
  | 'slideLeft'
  | 'slideRight'
  | 'pushLeft'
  | 'pushRight'
  | 'zoomIn'
  | 'zoomOut'
  | 'blur';

/**
 * A transition on the cut between two touching clips (fromClipId ends where toClipId starts),
 * centred on the cut: it runs from cut - duration/2 to cut + duration/2. The outgoing clip keeps
 * playing past its end and the incoming one starts early, using media beyond the trim points when
 * available, otherwise holding the first/last frame.
 */
export interface Transition {
  id: ID;
  kind: TransitionKind;
  duration: number;
  fromClipId: ID;
  toClipId: ID;
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

export type ShapeKind = 'rectangle' | 'square' | 'circle' | 'oval' | 'triangle' | 'star' | 'line';

/**
 * A vector shape, centred on the clip transform's position. Sizes are project pixels at scale 1.
 * Square and circle keep width = height. A line runs along the width (its angle is the rotation);
 * its height is ignored.
 */
export interface ShapeProps {
  kind: ShapeKind;
  width: number;
  height: number;
  /** No fill when absent. */
  fill?: string;
  /** 0..1, default 1. */
  fillOpacity?: number;
  /** No outline when absent (a line always strokes, falling back to white). */
  stroke?: string;
  strokeWidth: number;
  /** 0..1, default 1. */
  strokeOpacity?: number;
  dash?: 'solid' | 'dash' | 'dot';
  /** Rounded corners (px) for rectangle, square and triangle. */
  cornerRadius?: number;
  /** Star: number of points (3..20, default 5) and inner radius as a fraction of the outer (default 0.5). */
  points?: number;
  innerRadius?: number;
  /** Line: arrowheads. */
  arrowStart?: boolean;
  arrowEnd?: boolean;
  shadowColor?: string;
  /** Blur radius in project pixels at scale 1. */
  shadowBlur?: number;
  fadeIn: number;
  fadeOut: number;
}

/** How a visual clip mixes with the layers below it (After Effects' layer blend modes). */
export type BlendMode =
  | 'normal'
  | 'dissolve'
  | 'dancingDissolve'
  | 'darken'
  | 'multiply'
  | 'colorBurn'
  | 'classicColorBurn'
  | 'linearBurn'
  | 'darkerColor'
  | 'add'
  | 'lighten'
  | 'screen'
  | 'colorDodge'
  | 'classicColorDodge'
  | 'linearDodge'
  | 'lighterColor'
  | 'overlay'
  | 'softLight'
  | 'hardLight'
  | 'linearLight'
  | 'vividLight'
  | 'pinLight'
  | 'hardMix'
  | 'difference'
  | 'classicDifference'
  | 'exclusion'
  | 'subtract'
  | 'divide'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity';

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
  shape?: ShapeProps;
  /** Default 'normal'. */
  blend?: BlendMode;
  /** Applied in order to the clip's pixels (see model/effects.ts). */
  effects?: Effect[];
  /**
   * An adjustment layer: draws nothing itself; its effects (and filter) apply to everything below
   * it while it is on screen, mixed in by its opacity and blend mode.
   */
  adjustment?: boolean;
}

export type EffectKind =
  | 'gaussianBlur'
  | 'fastBoxBlur'
  | 'cameraLensBlur'
  | 'directionalBlur'
  | 'sharpen'
  | 'unsharpMask'
  | 'lumetri'
  | 'curves'
  | 'levels'
  | 'hueSaturation'
  | 'tint'
  | 'tritone'
  | 'brightnessContrast'
  | 'transform'
  | 'warpStabilizer'
  | 'turbulentDisplace'
  | 'displacementMap'
  | 'opticsCompensation'
  | 'powerPin'
  | 'fill'
  | 'gradientRamp'
  | 'fourColorGradient'
  | 'grid'
  | 'lensFlare'
  | 'stroke'
  | 'glow'
  | 'dropShadow'
  | 'motionTile'
  | 'roughenEdges'
  | 'findEdges'
  | 'posterize'
  | 'cameraTracker3d'
  | 'bevelAlpha'
  | 'sphere'
  | 'echo'
  | 'posterizeTime'
  | 'timewarp'
  | 'forceMotionBlur'
  | 'particleWorld'
  | 'particleSystems'
  | 'shatter'
  | 'keylight'
  | 'linearColorKey'
  | 'colorRange'
  | 'linearWipe'
  | 'radialWipe'
  | 'venetianBlinds'
  | 'blockDissolve'
  | 'gradientWipe'
  /** A Filters-pane preset (a colour/texture look with an intensity). */
  | 'look';

/** Parameter values by key; points are stored as `<key>X` / `<key>Y` fractions of the frame. */
export type EffectParams = Record<string, number | string | boolean>;

export interface Effect {
  id: ID;
  kind: EffectKind;
  enabled: boolean;
  params: EffectParams;
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
