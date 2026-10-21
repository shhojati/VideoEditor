import { z } from 'zod';
import { migrate } from './migrations';
import { EFFECT_KINDS } from './effects';
import { KEY_EASES } from './keyframes';
import { BLEND_MODES, SHAPE_KINDS } from './overlays';
import { PITCH_RANGE, SPACE_KINDS, VOICE_KINDS } from './voiceFx';
import type { Project } from './types';

const num = z.number().finite();
const nonNeg = num.min(0);
const unit = num.min(0).max(1);

const rect = z.object({ x: num, y: num, width: nonNeg, height: nonNeg });

const textProps = z.object({
  content: z.string(),
  fontFamily: z.string(),
  fontSize: num.positive(),
  fontWeight: num,
  color: z.string(),
  strokeColor: z.string().optional(),
  strokeWidth: nonNeg.optional(),
  bgColor: z.string().optional(),
  shadowColor: z.string().optional(),
  shadowBlur: nonNeg.optional(),
  align: z.enum(['left', 'center', 'right']),
  rtl: z.boolean(),
  maxWidth: num.min(0.05).max(1).optional(),
  fadeIn: nonNeg,
  fadeOut: nonNeg,
});

const opacity = num.min(0).max(1);

const shapeProps = z.object({
  kind: z.enum(SHAPE_KINDS),
  width: num.positive(),
  height: num.positive(),
  fill: z.string().optional(),
  fillOpacity: opacity.optional(),
  stroke: z.string().optional(),
  strokeWidth: nonNeg,
  strokeOpacity: opacity.optional(),
  dash: z.enum(['solid', 'dash', 'dot']).optional(),
  cornerRadius: nonNeg.optional(),
  points: num.int().min(3).max(20).optional(),
  innerRadius: num.min(0.05).max(1).optional(),
  arrowStart: z.boolean().optional(),
  arrowEnd: z.boolean().optional(),
  shadowColor: z.string().optional(),
  shadowBlur: nonNeg.optional(),
  fadeIn: nonNeg,
  fadeOut: nonNeg,
});

const animated = <T extends z.ZodType>(v: T) => z.object({ value: v, keys: z.array(z.object({ t: num, v })).optional() });

const maskPath = z.array(z.tuple([num, num, num, num, num, num]));

const rotoMask = z.object({
  id: z.string(),
  name: z.string(),
  mode: z.enum(['add', 'subtract', 'intersect', 'difference']),
  inverted: z.boolean().optional(),
  off: z.boolean().optional(),
  path: animated(maskPath),
  feather: animated(nonNeg),
  expansion: animated(num),
  opacity: animated(opacity),
  track: z.object({ trackerId: z.string(), position: z.boolean(), rotation: z.boolean(), scale: z.boolean(), ref: num }).optional(),
});

const clip = z.object({
  id: z.string(),
  assetId: z.string().optional(),
  start: nonNeg,
  duration: num.positive(),
  inPoint: nonNeg,
  speed: num.positive(),
  transform: z.object({
    x: num,
    y: num,
    scale: num.positive(),
    rotation: num,
    opacity: num.min(0).max(1),
    crop: rect.optional(),
    fit: z.enum(['contain', 'cover']).optional(),
  }),
  audio: z.object({
    volume: nonNeg,
    fadeIn: nonNeg,
    fadeOut: nonNeg,
    voice: z.object({ kind: z.enum(VOICE_KINDS), pitch: num.min(PITCH_RANGE.min).max(PITCH_RANGE.max), amount: unit }).optional(),
    space: z.object({ kind: z.enum(SPACE_KINDS), mix: unit, size: unit }).optional(),
    keepPitch: z.boolean().optional(),
  }),
  text: textProps.optional(),
  shape: shapeProps.optional(),
  blend: z.enum(BLEND_MODES).optional(),
  effects: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(EFFECT_KINDS),
        enabled: z.boolean(),
        params: z.record(z.string(), z.union([num, z.string(), z.boolean()])),
      }),
    )
    .optional(),
  adjustment: z.boolean().optional(),
  masks: z.array(rotoMask).optional(),
  trackers: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        width: num.positive(),
        height: num.positive(),
        samples: z.array(z.tuple([num, num, num, num, num.positive()])),
        lostAt: num.optional(),
      }),
    )
    .optional(),
  motion: z
    .object({
      clipId: z.string(),
      trackerId: z.string(),
      mode: z.enum(['follow', 'stabilize']),
      position: z.boolean(),
      rotation: z.boolean(),
      scale: z.boolean(),
      ref: num,
    })
    .optional(),
  keyframes: z
    .array(z.object({ t: num, ease: z.enum(KEY_EASES).optional(), v: z.record(z.string(), num) }))
    .transform((keys) => [...keys].sort((a, b) => a.t - b.t))
    .optional(),
});

const track = z.object({
  id: z.string(),
  kind: z.enum(['video', 'audio', 'text']),
  muted: z.boolean(),
  locked: z.boolean(),
  clips: z.array(clip),
  transitions: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(['crossfade', 'dipBlack', 'dipWhite', 'wipeLeft', 'wipeRight', 'wipeUp', 'wipeDown', 'slideLeft', 'slideRight', 'pushLeft', 'pushRight', 'zoomIn', 'zoomOut', 'blur']),
        duration: num.positive(),
        fromClipId: z.string(),
        toClipId: z.string(),
      }),
    )
    .optional(),
});

const asset = z.object({
  id: z.string(),
  kind: z.enum(['video', 'audio', 'image']),
  name: z.string(),
  duration: nonNeg.optional(),
  width: num.positive().optional(),
  height: num.positive().optional(),
  fps: num.positive().optional(),
  hasAudio: z.boolean().optional(),
  size: nonNeg.optional(),
  mimeType: z.string().optional(),
  codecs: z.object({ video: z.string().optional(), audio: z.string().optional() }).optional(),
  fileRef: z.object({ opfsPath: z.string().optional(), handleKey: z.string().optional() }),
  library: z.object({ kind: z.enum(['stickers', 'sounds', 'overlays']), path: z.string() }).optional(),
});

const cue = z
  .object({ id: z.string(), start: nonNeg, end: nonNeg, text: z.string(), flag: z.literal('review').optional() })
  .refine((c) => c.end > c.start, 'cue end must be after start');

const subtitleTrack = z.object({
  id: z.string(),
  language: z.string(),
  rtl: z.boolean(),
  hidden: z.boolean().optional(),
  style: z.object({
    fontFamily: z.string(),
    fontSize: num.positive(),
    fontWeight: num.optional(),
    color: z.string(),
    bgColor: z.string().optional(),
    bgOpacity: num.min(0).max(1).optional(),
    strokeColor: z.string().optional(),
    strokeWidth: nonNeg.optional(),
    position: z.enum(['bottom', 'middle', 'top']),
    marginY: num,
    maxWidthPct: num.min(10).max(100),
    digits: z.enum(['keep', 'persian', 'latin']).optional(),
    highlightActiveWord: z.boolean().optional(),
  }),
  cues: z.array(cue),
});

export const projectSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  version: z.number().int(),
  settings: z.object({
    width: num.int().positive(),
    height: num.int().positive(),
    fps: num.positive(),
    sampleRate: num.int().positive(),
    platform: z.enum(['instagramReels', 'instagramPost', 'youtube', 'tiktok']).optional(),
  }),
  assets: z.record(z.string(), asset),
  tracks: z.array(track),
  subtitleTracks: z.array(subtitleTrack),
});

export class InvalidProjectError extends Error {}

/** Migrate stored JSON to the current version and validate it. Throws on anything unusable. */
export function parseProject(raw: unknown): Project {
  const migrated = migrate(raw);
  const result = projectSchema.safeParse(migrated);
  if (!result.success) {
    const first = result.error.issues[0];
    throw new InvalidProjectError(`Invalid project at ${first.path.join('.') || '(root)'}: ${first.message}`);
  }
  return result.data as Project;
}
