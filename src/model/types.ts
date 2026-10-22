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
  /** Timeline markers (M), ascending. */
  markers?: Marker[];
  /** Colour lookup tables used by LUT effects: imported .cube files and built-ins (model/luts.ts). */
  luts?: Record<ID, ProjectLut>;
  /** The insides of compound clips (model/sequences.ts), by id. */
  sequences?: Record<ID, Sequence>;
}

/** A nested timeline: what a compound clip shows. Same frame size and rate as the project. */
export interface Sequence {
  id: ID;
  name: string;
  /** Ordered bottom -> top, like Project.tracks. */
  tracks: Track[];
}

export interface ProjectLut {
  name: string;
  /** Points per axis. */
  size: number;
  /** size³ RGB bytes (red fastest, then green, then blue), base64. */
  data: string;
}

export interface Marker {
  id: ID;
  /** Timeline seconds. */
  t: number;
  label?: string;
  color?: string;
}

export type AssetKind = 'video' | 'audio' | 'image';

/** Server library folders (library/<kind>/…). */
export type LibraryKind = 'stickers' | 'sounds' | 'overlays' | 'templates';

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
  /** Detected tempo and beats (music), see engine/audio/beats.ts. */
  beats?: { bpm: number; times: number[] };
  /** A reversed copy of another asset's range [from, to] (made by Reverse, model/speed.ts). */
  reverseOf?: { assetId: ID; from: number; to: number };
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
  /** Changes the voice itself (pitch, robot, telephone…); see model/voiceFx.ts. */
  voice?: VoiceFx;
  /** Places the sound in a space (echo, reverb); its tail rings past the clip's end. */
  space?: SpaceFx;
  /** Speed changes keep the original pitch. */
  keepPitch?: boolean;
  /** Gets quieter while other clips have speech (music under a voiceover); see engine/audio/ducking.ts. */
  duck?: ClipDuck;
  /** Noise reduction and voice enhance; see engine/audio/cleanDsp.ts. */
  clean?: ClipClean;
  /** Extra gain in dB, set by Normalize. */
  gainDb?: number;
}

export interface ClipClean {
  /** Noise reduction strength 0..1 (0 = off). */
  denoise: number;
  /** Clearer speech: rumble cut, presence, gentle compression (and some noise reduction). */
  enhance?: boolean;
}

export interface ClipDuck {
  /** How far down, in dB (negative). */
  amount: number;
  /** Seconds to go down before speech starts. */
  attack: number;
  /** Seconds to come back up after it ends. */
  release: number;
}

export type VoiceKind =
  | 'chipmunk'
  | 'helium'
  | 'child'
  | 'deep'
  | 'giant'
  | 'monster'
  | 'robot'
  | 'alien'
  | 'underwater'
  | 'vibrato'
  | 'telephone'
  | 'radio'
  | 'megaphone'
  | 'walkie';

export interface VoiceFx {
  kind: VoiceKind;
  /** Semitones, -12..12. */
  pitch: number;
  /** 0..1: how much of the preset's character (filters, robot, drive…) is mixed in. */
  amount: number;
}

export type SpaceKind = 'echo' | 'cave' | 'hall' | 'room';

export interface SpaceFx {
  kind: SpaceKind;
  /** 0..1 wet level. */
  mix: number;
  /** 0..1: echo time or room size. */
  size: number;
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
  /** In/out animations (model/textAnim.ts); `duration` is each one's length in seconds. */
  anim?: { in?: TextAnimKind; out?: TextAnimKind; duration?: number };
}

export type TextAnimKind = 'fade' | 'slideUp' | 'slideDown' | 'slideLeft' | 'slideRight' | 'pop' | 'zoom' | 'typewriter' | 'wordByWord' | 'blurIn' | 'wipe';

export type ShapeKind = 'rectangle' | 'square' | 'circle' | 'oval' | 'triangle' | 'star' | 'line' | 'path';

/**
 * A vector shape, centred on the clip transform's position. Sizes are project pixels at scale 1.
 * Square and circle keep width = height. A line runs along the width (its angle is the rotation);
 * its height is ignored. A path (drawn with the pen) is `path`, in project pixels at scale 1 around
 * the position; its width and height are only its size when drawn.
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
  /** Path: Bézier points like a mask's (keyframes in the clip's source time), and whether it closes. */
  path?: Animated<MaskVertex[]>;
  closed?: boolean;
  shadowColor?: string;
  /** Blur radius in project pixels at scale 1. */
  shadowBlur?: number;
  fadeIn: number;
  fadeOut: number;
}

/**
 * A brush stroke (After Effects' paint) in the clip's layer units, like mask points. Times are
 * source times of the clip, like keyframes, so trims and splits keep them.
 */
export interface PaintStroke {
  id: ID;
  /** brush paints `color`; eraser rubs out the clip and the paint under it; clone copies the picture `clone` away. */
  tool: 'brush' | 'eraser' | 'clone';
  /** x, y and pressure (0..1) of each point, one after another. */
  points: number[];
  /** Drawn with a pen: its pressure changes the width (otherwise an even line). */
  pressure?: boolean;
  /** Diameter, layer units. */
  size: number;
  /** 0..1: 1 a crisp edge, lower a softer one. */
  hardness: number;
  /** 0..1 */
  opacity: number;
  color: string;
  /** Shows from source time `start` for `duration` s (absent: to the end of the clip). */
  start: number;
  duration?: number;
  /** Draws itself along its path over this many seconds from `start` (After Effects' Write On). */
  writeOn?: number;
  /** Clone: where the picture is taken from, relative to the painted point (layer units). */
  clone?: { dx: number; dy: number };
}

/** Brush strokes: on a video or photo they paint on it; a clip with only paint is a paint layer. */
export interface PaintProps {
  strokes: PaintStroke[];
  /** Frame-by-frame drawing: each drawing holds this many frames (1, 2 or 3: on ones, twos, threes). */
  frames?: { hold: number };
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
  /** 1 = normal. Ignored while there is a speed curve. See model/remap.ts. */
  speed: number;
  /** Speed ramp: absolute speeds at points of normalized clip time (0..1), linear in between. */
  speedCurve?: SpeedPoint[];
  /** Which ramp preset the curve came from (for the picker). */
  speedPreset?: SpeedPreset;
  /** Holds the frame at inPoint (a freeze frame clip; silent). */
  freeze?: true;
  /** Spoken words (source time), for text-based editing; see model/transcript.ts. */
  transcript?: ClipTranscript;
  /** A compound clip: plays this sequence (Project.sequences) instead of a media file. */
  sequenceId?: ID;
  transform: Transform;
  audio: ClipAudio;
  text?: TextProps;
  shape?: ShapeProps;
  /** Brush strokes painted on the clip, or, alone, a paint layer (see model/paint.ts). */
  paint?: PaintProps;
  /** A solid layer: the frame filled with one colour (at scale 1, around the position). */
  solid?: { color: string };
  /** A null object: draws nothing; it is there to be a parent. */
  nullObject?: true;
  /**
   * After Effects' parenting: this clip's transform is relative to that clip's (same timeline), so
   * it moves, turns and scales with it. See engine/render/parenting.ts.
   */
  parentId?: ID;
  /** Default 'normal'. */
  blend?: BlendMode;
  /** Applied in order to the clip's pixels (see model/effects.ts). */
  effects?: Effect[];
  /**
   * An adjustment layer: draws nothing itself; its effects (and filter) apply to everything below
   * it while it is on screen, mixed in by its opacity and blend mode.
   */
  adjustment?: boolean;
  /**
   * Roto masks, applied top to bottom: on a clip they cut it out; on an adjustment layer they limit
   * where its effects apply. See model/masks.ts.
   */
  masks?: RotoMask[];
  /** Video clips: objects tracked in the clip's media (see model/motion.ts). */
  trackers?: Tracker[];
  /** Move with a tracked object (or, on the tracked clip itself, against it: stabilize). */
  motion?: MotionLink;
  /** InShot-style animation: sorted by time (see model/keyframes.ts). */
  keyframes?: ClipKeyframe[];
}

/** How values travel from a keyframe to the next one. */
export type KeyEase = 'linear' | 'easeIn' | 'easeOut' | 'easeInOut' | 'hold';

/**
 * A snapshot of a clip's animatable values at source time `t` (like tracker samples, so trims and
 * splits keep it). Values by property: x, y, scale, rotation, opacity, volume, shape.width,
 * shape.height, voice.pitch, voice.amount, space.mix and fx.<effectId>.<param> for numeric effect
 * settings. A property missing from a
 * keyframe is interpolated from the keyframes that have it.
 */
export interface ClipKeyframe {
  t: number;
  /** Default 'easeInOut'. */
  ease?: KeyEase;
  v: Record<string, number>;
}

/** A keyframe: source time of the clip (s), like tracker samples, so trims and splits keep it. */
export interface Keyframe<T> {
  t: number;
  v: T;
}

/** A value that may be animated: `keys` (sorted, linear in between) when present, else `value`. */
export interface Animated<T> {
  value: T;
  keys?: Keyframe<T>[];
}

/**
 * One point of a mask path and its Bézier handles (relative to the point), in the clip's layer
 * units: source pixels for video and images (origin at the top-left of the uncropped picture),
 * otherwise project pixels at scale 1 around the clip's position.
 */
export type MaskVertex = [x: number, y: number, inX: number, inY: number, outX: number, outY: number];

export type MaskMode = 'add' | 'subtract' | 'intersect' | 'difference';

/** A closed path that cuts out (or, on adjustment layers, limits) a clip. */
export interface RotoMask {
  id: ID;
  name: string;
  mode: MaskMode;
  inverted?: boolean;
  /** Switched off: kept but not applied. */
  off?: boolean;
  /** Every keyframe has the same number of vertices. */
  path: Animated<MaskVertex[]>;
  /** Soft edge and grow (+) / shrink (−) of the edge, in layer units. */
  feather: Animated<number>;
  expansion: Animated<number>;
  /** 0..1 */
  opacity: Animated<number>;
  /** Video clips: carried by a tracker of the same media; keyframes are relative to its pose at `ref`. */
  track?: MaskTrack;
}

export interface MaskTrack {
  trackerId: ID;
  position: boolean;
  rotation: boolean;
  scale: boolean;
  /** Source time at which the path is drawn exactly as stored. */
  ref: number;
}

/**
 * One tracker sample: source time (s), box centre x / y (fractions of the source's display width /
 * height), angle (degrees, clockwise, unwrapped) and scale (relative to the tracker's width/height).
 */
export type TrackSample = [time: number, x: number, y: number, angle: number, scale: number];

/** A box followed through a video clip's media. Samples are in source time, so trims keep them valid. */
export interface Tracker {
  id: ID;
  name: string;
  /** Box size at scale 1, as fractions of the source's display width / height. */
  width: number;
  height: number;
  /** Sorted by time. */
  samples: TrackSample[];
  /** Source time where tracking stopped because the object was lost. */
  lostAt?: number;
}

export interface MotionLink {
  /** A tracker on a video clip (see resolveTracker in model/motion.ts for which clip is used). */
  clipId: ID;
  trackerId: ID;
  /**
   * 'follow': this clip moves with the object; 'stabilize': the tracked clip moves against it;
   * 'reframe': the clip (filling the frame) slides so the subject stays centred (auto reframe).
   */
  mode: 'follow' | 'stabilize' | 'reframe';
  position: boolean;
  rotation: boolean;
  scale: boolean;
  /** Source time (of the tracked clip) at which this clip's own transform applies unchanged. */
  ref: number;
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
  | 'mosaic'
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
  | 'look'
  | 'lut3d'
  | 'colorWheels';

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
  /** Word-by-word animation (uses Cue.words, or timing estimated from text length). */
  animation?: SubtitleAnimation;
  /** Colour of the spoken word (karaoke, pop, single). */
  highlightColor?: string;
  /** Box behind the spoken word (karaoke). */
  highlightBg?: string;
  /** Size of the spoken word relative to the others, 1..2 (pop, single). */
  activeScale?: number;
}

export type SubtitleAnimation = 'none' | 'karaoke' | 'pop' | 'single' | 'typewriter';

/** One spoken word, in timeline seconds (the same clock as its cue). */
export interface CueWord {
  text: string;
  start: number;
  end: number;
}

export interface Cue {
  id: ID;
  start: number;
  end: number;
  text: string;
  /** Set by auto-generation for cues worth a second look; cleared when the text is edited. */
  flag?: 'review';
  /** Word timings from speech-to-text. Kept in step with the text by model/subtitles.ts. */
  words?: CueWord[];
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

/** [u, speed]: normalized clip time 0..1 and the speed there (0.1..10). */
export type SpeedPoint = [number, number];

export interface ClipTranscript {
  language: string;
  rtl: boolean;
  /** Source seconds. */
  words: { text: string; s: number; e: number }[];
}

export type SpeedPreset = 'montage' | 'hero' | 'bullet' | 'flashIn' | 'flashOut' | 'jumpCut' | 'custom';
