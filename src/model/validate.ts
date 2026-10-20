import { z } from 'zod';
import { migrate } from './migrations';
import type { Project } from './types';

const num = z.number().finite();
const nonNeg = num.min(0);

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
  audio: z.object({ volume: nonNeg, fadeIn: nonNeg, fadeOut: nonNeg }),
  text: textProps.optional(),
});

const track = z.object({
  id: z.string(),
  kind: z.enum(['video', 'audio', 'text']),
  muted: z.boolean(),
  locked: z.boolean(),
  clips: z.array(clip),
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
