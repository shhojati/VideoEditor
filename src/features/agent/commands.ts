// What an AI agent can do in the editor (through the MCP server, see bridge.ts and server/src/mcp.ts).
// Each command checks its input with zod and edits through useProjectStore().edit, so every agent
// change is one ordinary undo step. The same list is the MCP tool list (agentToolList), checked into
// server/src/agentTools.json by commands.test.ts.
import { z } from 'zod';
import { detectRtl } from '../../engine/render/textLayout';
import { playbackEngine } from '../../engine/playback/engine';
import { EXPORT_FORMATS, type ExportSettings } from '../../engine/export/settings';
import { WHISPER_SIZES } from '../../engine/stt/models';
import { parseSubtitles } from '../../lib/subtitles/formats';
import type { LibraryItem } from '../../lib/library';
import { acceptsEffects, createEffect, defaultParams, EFFECT_DEFS, EFFECT_KINDS, setFilter } from '../../model/effects';
import { createSubtitleTrack, createTrack, newId } from '../../model/factories';
import { addKeyAt, clearKeys, KEY_EASES, keyIndexAt, setKeyEase, srcTime, writeProps } from '../../model/keyframes';
import { defaultShape, TEXT_STYLE_DEFAULTS } from '../../model/overlays';
import { keyRate } from '../../model/remap';
import { addCue, deleteCues, findCue, setCueEdge, setCueText } from '../../model/subtitles';
import { insertTemplate } from '../../model/templates';
import {
  addShapeClip,
  addSolidClip,
  addTextClip,
  clipEnd,
  createClip,
  deleteClips,
  detachAudio,
  findClip,
  insertClip,
  isFree,
  moveClips,
  nearestFreeStart,
  setClipSpeed,
  splitClips,
  timelineDuration,
  trackAccepts,
  trackKindFor,
  trimClip,
} from '../../model/timeline';
import { setTransition, TRANSITION_KINDS } from '../../model/transitions';
import type { BlendMode, Clip, EffectKind, ID, LibraryKind, Project, ShapeKind, TextAnimKind } from '../../model/types';
import { keyTolerance } from '../../model/masks';
import { useAccount } from '../../store/account';
import { currentProject, useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { aiAccess } from '../account/policy';
import { useExport } from '../export/exportService';
import { loadLibrary, ensureLibraryAsset, useLibrary } from '../library/libraryService';
import { startAutoSubtitles, useStt } from '../subtitles/sttService';
import { translateTrack, useTranslate } from '../subtitles/translateService';
import { allTemplates, loadServerTemplates, useTemplates } from '../templates/templateService';

/** MCP tool result content. */
export type ToolContent = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

/** A failure the agent can act on; its message is shown to it as is. */
export class AgentError extends Error {}

interface Command<S extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  input: S;
  /** Read-only commands are marked for the agent (MCP readOnlyHint). */
  readOnly?: boolean;
  /** A plain value is sent as JSON text; a ToolResult as it is. */
  run: (args: z.infer<S>) => unknown;
}

const command = <S extends z.ZodType>(c: Command<S>) => c as unknown as Command;

// ---- shared pieces ----------------------------------------------------------------------------------

const seconds = z.number().min(0).max(24 * 3600);
const id = z.string().min(1).max(100);
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'a colour like #ff8800');
const LIBRARY_KINDS = ['stickers', 'sounds', 'overlays', 'backgrounds'] as const satisfies readonly LibraryKind[];
const SHAPE_KINDS = ['rectangle', 'square', 'circle', 'oval', 'triangle', 'star', 'polygon', 'line'] as const satisfies readonly ShapeKind[];
const TEXT_ANIMS = ['fade', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'pop', 'zoom', 'typewriter', 'wordByWord', 'blurIn', 'wipe'] as const satisfies readonly TextAnimKind[];
const BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'softLight', 'hardLight', 'darken', 'lighten', 'add', 'difference', 'color', 'luminosity'] as const satisfies readonly BlendMode[];
const ADDABLE_EFFECTS = EFFECT_KINDS.filter((k) => !EFFECT_DEFS[k].later && k !== 'lut3d' && k !== 'look');
const LOOK_PRESETS = (EFFECT_DEFS.look.params.find((p) => p.key === 'preset') as { options: readonly string[] }).options;

const transform = z
  .object({
    x: z.number().min(-2).max(2).describe('Centre offset as a fraction of the frame width: 0 centred, -0.5 left edge, 0.5 right edge'),
    y: z.number().min(-2).max(2).describe('Centre offset as a fraction of the frame height: 0 centred, -0.5 top, 0.5 bottom'),
    scale: z.number().min(0.01).max(20),
    rotation: z.number().min(-3600).max(3600).describe('Degrees, clockwise'),
    opacity: z.number().min(0).max(1),
  })
  .partial();

const textStyle = z
  .object({
    content: z.string().min(1).max(2000),
    fontFamily: z.string().max(100),
    fontSize: z.number().min(4).max(1000).describe('Pixels in project resolution'),
    fontWeight: z.number().int().min(100).max(900),
    color,
    strokeColor: color,
    strokeWidth: z.number().min(0).max(100),
    bgColor: color,
    align: z.enum(['left', 'center', 'right']),
    animIn: z.enum(TEXT_ANIMS),
    animOut: z.enum(TEXT_ANIMS),
  })
  .partial();

const shapeStyle = z
  .object({
    width: z.number().min(1).max(10000),
    height: z.number().min(1).max(10000),
    fill: color,
    stroke: color,
    strokeWidth: z.number().min(0).max(500),
    cornerRadius: z.number().min(0).max(5000),
  })
  .partial();

function project(): Project {
  const p = currentProject();
  if (!p) throw new AgentError('No project is open. Ask the user to open or create a project in Vidora.');
  return p;
}

/**
 * Run an edit as one undo step; `fn` returns what the tool reports. A throw inside `fn` aborts the
 * Immer recipe, so a half-done edit is never recorded.
 */
function edit<T>(label: string, fn: (d: Project) => T): T {
  project();
  let out!: T;
  useProjectStore.getState().edit(label, (d) => void (out = fn(d)));
  return out;
}

function clipIn(p: Project, clipId: ID) {
  const ref = findClip(p, clipId);
  if (!ref) throw new AgentError(`No clip with id ${clipId}. Call get_project for the current ids.`);
  if (ref.track.locked) throw new AgentError(`Clip ${clipId} is on a locked track.`);
  return ref;
}

const round = (v: number) => Math.round(v * 1000) / 1000;

function clipType(p: Project, c: Clip): string {
  if (c.text) return 'text';
  if (c.shape) return 'shape';
  if (c.solid) return 'solid';
  if (c.adjustment) return 'adjustment';
  if (c.nullObject) return 'null';
  if (c.paint && !c.assetId) return 'paint';
  if (c.sequenceId) return 'compound';
  return (c.assetId && p.assets[c.assetId]?.kind) || 'unknown';
}

function clipSummary(p: Project, c: Clip) {
  const asset = c.assetId ? p.assets[c.assetId] : undefined;
  return {
    id: c.id,
    type: clipType(p, c),
    start: round(c.start),
    end: round(clipEnd(c)),
    ...(asset && { asset: asset.name, assetId: asset.id, inPoint: round(c.inPoint) }),
    ...(c.speed !== 1 && { speed: c.speed }),
    ...(c.text && { text: c.text.content }),
    ...(c.shape && { shape: c.shape.kind }),
    ...(c.effects?.length && { effects: c.effects.map((e) => ({ id: e.id, kind: e.kind })) }),
    ...(c.keyframes?.length && { keyframes: c.keyframes.length }),
  };
}

function applyText(c: Clip, { animIn, animOut, ...rest }: z.infer<typeof textStyle>) {
  if (!c.text) return;
  Object.assign(c.text, rest);
  if (animIn || animOut) c.text.anim = { ...c.text.anim, ...(animIn && { in: animIn }), ...(animOut && { out: animOut }) };
  if (rest.content) c.text.rtl = detectRtl(rest.content);
}

/** Set the length of a clip from its start (clamped like a trim). */
function setDuration(d: Project, clipId: ID, duration: number) {
  const c = findClip(d, clipId)!.clip;
  trimClip(d, clipId, 'end', c.start + duration);
}

/** A clip of the asset at `start`: on `trackId`, or the top free track that takes it, or a new one. */
function placeAsset(d: Project, assetId: ID, start: number, trackId?: ID, bottom = false): ID {
  const asset = d.assets[assetId];
  if (!asset) throw new AgentError(`No asset with id ${assetId}. Call list_assets.`);
  const clip = createClip(asset, start);
  let track = trackId ? d.tracks.find((t) => t.id === trackId) : undefined;
  if (trackId && !track) throw new AgentError(`No track with id ${trackId}.`);
  if (track && (track.locked || !trackAccepts(track, asset.kind)))
    throw new AgentError(`Track ${trackId} cannot take a ${asset.kind} clip (wrong kind or locked).`);
  if (track) clip.start = nearestFreeStart(track, start, clip.duration);
  else {
    const candidates = bottom ? d.tracks : [...d.tracks].reverse();
    track = candidates.find((t) => !t.locked && trackAccepts(t, asset.kind) && isFree(t, start, clip.duration));
  }
  if (!track) {
    track = createTrack(trackKindFor(asset.kind));
    if (track.kind === 'audio') d.tracks.unshift(track);
    else if (bottom) {
      const firstVisual = d.tracks.findIndex((t) => t.kind !== 'audio');
      d.tracks.splice(firstVisual < 0 ? d.tracks.length : firstVisual, 0, track);
    } else d.tracks.push(track);
  }
  insertClip(track, clip);
  return clip.id;
}

/** Set a few seconds-long job going and return straight away; the agent polls job_status. */
const started = (what: string) => ({ started: what, next: 'Call job_status every few seconds until it is done.' });

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

// ---- the commands ------------------------------------------------------------------------------------

export const COMMANDS: Command[] = [
  // ---- reading
  command({
    name: 'get_project',
    description:
      'The open project: settings, length, playhead, every track (bottom to top) with its clips, and subtitle tracks. Call this first and after edits to get ids. Times are seconds.',
    input: z.object({}),
    readOnly: true,
    run: () => {
      const p = project();
      return {
        name: p.name,
        width: p.settings.width,
        height: p.settings.height,
        fps: p.settings.fps,
        duration: round(timelineDuration(p)),
        playhead: round(useTransport.getState().time),
        insideCompound: p !== useProjectStore.getState().history?.present,
        tracks: p.tracks.map((t, index) => ({
          id: t.id,
          index,
          kind: t.kind === 'text' ? 'graphics' : t.kind,
          ...(t.locked && { locked: true }),
          ...(t.muted && { muted: true }),
          ...(t.hidden && { hidden: true }),
          clips: t.clips.map((c) => clipSummary(p, c)),
          ...(t.transitions?.length && { transitions: t.transitions.map((x) => ({ id: x.id, kind: x.kind, from: x.fromClipId, to: x.toClipId, duration: x.duration })) }),
        })),
        subtitleTracks: p.subtitleTracks.map((s) => ({ id: s.id, language: s.language, cues: s.cues.length, ...(s.hidden && { hidden: true }) })),
        assets: Object.keys(p.assets).length,
      };
    },
  }),

  command({
    name: 'list_assets',
    description: 'Media in the project (videos, sounds, pictures) with ids for add_clip. The user imports files; an agent can only add library items (add_library_item).',
    input: z.object({}),
    readOnly: true,
    run: () =>
      Object.values(project().assets).map((a) => ({
        id: a.id,
        kind: a.kind,
        name: a.name,
        ...(a.duration !== undefined && { duration: round(a.duration) }),
        ...(a.width && { width: a.width, height: a.height }),
        ...(a.kind === 'video' && { hasAudio: !!a.hasAudio }),
        ...(a.library && { library: a.library.kind }),
      })),
  }),

  command({
    name: 'get_clip',
    description: 'Every setting of one clip (transform, text, shape, audio, effects with params, keyframes).',
    input: z.object({ clipId: id }),
    readOnly: true,
    run: ({ clipId }) => {
      const p = project();
      const ref = findClip(p, clipId);
      if (!ref) throw new AgentError(`No clip with id ${clipId}.`);
      return { trackId: ref.track.id, type: clipType(p, ref.clip), ...JSON.parse(JSON.stringify(ref.clip)) };
    },
  }),

  // ---- adding
  command({
    name: 'add_clip',
    description:
      'Put an asset on the timeline at `start`. Without trackId it goes on the top free track that takes it (or a new one). Optional inPoint (seconds into the source) and duration trim it.',
    input: z.object({ assetId: id, start: seconds, trackId: id.optional(), inPoint: seconds.optional(), duration: z.number().positive().optional() }),
    run: ({ assetId, start, trackId, inPoint, duration }) =>
      edit('ops.addClip', (d) => {
        const clipId = placeAsset(d, assetId, start, trackId);
        const c = findClip(d, clipId)!.clip;
        if (inPoint) {
          const max = (d.assets[assetId].duration ?? Infinity) - 0.1;
          c.inPoint = Math.min(inPoint, max);
          c.duration = Math.min(c.duration, ((d.assets[assetId].duration ?? Infinity) - c.inPoint) / c.speed);
        }
        if (duration) setDuration(d, clipId, duration);
        return clipSummary(d, c);
      }),
  }),

  command({
    name: 'add_text',
    description:
      'Add a text clip (title, caption, label) on a graphics track. Defaults: 3 s, white bold 72 px Vazirmatn with a black outline, slightly below centre. Persian/Arabic text is detected and laid out right-to-left.',
    input: textStyle.extend({ content: z.string().min(1).max(2000), start: seconds.default(0), duration: z.number().positive().max(3600).optional(), transform: transform.optional() }),
    run: ({ start, duration, transform: tr, ...style }) =>
      edit('ops.addText', (d) => {
        const clipId = addTextClip(d, start, { ...TEXT_STYLE_DEFAULTS, content: style.content, rtl: detectRtl(style.content) });
        const c = findClip(d, clipId)!.clip;
        applyText(c, style);
        if (tr) Object.assign(c.transform, tr);
        if (duration) c.duration = duration;
        return clipSummary(d, c);
      }),
  }),

  command({
    name: 'add_shape',
    description: 'Add a vector shape (rectangle, circle, star, line…) on a graphics track. Sizes are project pixels.',
    input: shapeStyle.extend({ kind: z.enum(SHAPE_KINDS), start: seconds.default(0), duration: z.number().positive().max(3600).optional(), transform: transform.optional() }),
    run: ({ kind, start, duration, transform: tr, ...style }) =>
      edit('ops.addShape', (d) => {
        const clipId = addShapeClip(d, start, { ...defaultShape(kind), ...style });
        const c = findClip(d, clipId)!.clip;
        if (tr) Object.assign(c.transform, tr);
        if (duration) c.duration = duration;
        return clipSummary(d, c);
      }),
  }),

  command({
    name: 'add_solid',
    description: 'Add a full-frame solid colour layer (a background or a colour wash) on a graphics track.',
    input: z.object({ color, start: seconds.default(0), duration: z.number().positive().max(3600).optional() }),
    run: ({ color: c, start, duration }) =>
      edit('ops.addSolid', (d) => {
        const clipId = addSolidClip(d, start, c);
        if (duration) findClip(d, clipId)!.clip.duration = duration;
        return clipSummary(d, findClip(d, clipId)!.clip);
      }),
  }),

  // ---- changing clips
  command({
    name: 'update_clip',
    description:
      'Change a clip: length, transform (position/scale/rotation/opacity), blend mode, sound (volume 0..2, fades), text style or shape style. On a clip with keyframes, transform and volume changes land in a keyframe at `time` (default the clip start).',
    input: z.object({
      clipId: id,
      duration: z.number().positive().optional(),
      transform: transform.optional(),
      blend: z.enum(BLENDS).optional(),
      volume: z.number().min(0).max(2).optional(),
      fadeIn: z.number().min(0).max(60).optional(),
      fadeOut: z.number().min(0).max(60).optional(),
      text: textStyle.optional(),
      shape: shapeStyle.optional(),
      time: seconds.optional(),
    }),
    run: ({ clipId, duration, transform: tr, blend, volume, fadeIn, fadeOut, text, shape, time }) =>
      edit('ops.clipProp', (d) => {
        const { clip } = clipIn(d, clipId);
        if (text && !clip.text) throw new AgentError('That clip is not a text clip.');
        if (shape && !clip.shape) throw new AgentError('That clip is not a shape clip.');
        const values: Record<string, number> = { ...tr, ...(volume !== undefined && { volume }) };
        if (!clip.keyframes?.length) writeProps(clip, values);
        else if (Object.keys(values).length) {
          const s = srcTime(clip, Math.min(clipEnd(clip), Math.max(clip.start, time ?? clip.start)));
          const tol = keyTolerance(d.settings.fps, keyRate(clip));
          addKeyAt(clip, s, tol);
          Object.assign(clip.keyframes[keyIndexAt(clip, s, tol)].v, values);
        }
        if (blend) clip.blend = blend;
        if (fadeIn !== undefined) (clip.text ?? clip.shape ?? clip.audio).fadeIn = fadeIn;
        if (fadeOut !== undefined) (clip.text ?? clip.shape ?? clip.audio).fadeOut = fadeOut;
        if (text) applyText(clip, text);
        if (shape && clip.shape) Object.assign(clip.shape, shape);
        if (duration) setDuration(d, clipId, duration);
        return clipSummary(d, findClip(d, clipId)!.clip);
      }),
  }),

  command({
    name: 'move_clip',
    description: 'Move a clip to a new start time, optionally onto another track of the same kind. Fails if it would overlap another clip.',
    input: z.object({ clipId: id, start: seconds, trackId: id.optional() }),
    run: ({ clipId, start, trackId }) =>
      edit('ops.moveClips', (d) => {
        const ref = clipIn(d, clipId);
        if (!moveClips(d, [{ clipId, trackId: trackId ?? ref.track.id, start }]))
          throw new AgentError('Cannot move there: it overlaps another clip, the track is locked, or the track kind differs.');
        return clipSummary(d, findClip(d, clipId)!.clip);
      }),
  }),

  command({
    name: 'trim_clip',
    description: "Move a clip's start or end edge to timeline time `time` (clamped to the source media and neighbouring clips).",
    input: z.object({ clipId: id, edge: z.enum(['start', 'end']), time: seconds }),
    run: ({ clipId, edge, time }) =>
      edit('ops.trimClip', (d) => {
        clipIn(d, clipId);
        trimClip(d, clipId, edge, time);
        return clipSummary(d, findClip(d, clipId)!.clip);
      }),
  }),

  command({
    name: 'split',
    description: 'Cut clips in two at timeline time `time`: the given clips, or every clip under that time on unlocked tracks. Returns the ids of the new right-hand parts.',
    input: z.object({ time: seconds, clipIds: z.array(id).max(200).optional() }),
    run: ({ time, clipIds }) => edit('ops.split', (d) => ({ newClipIds: splitClips(d, time, clipIds && new Set(clipIds)) })),
  }),

  command({
    name: 'delete_clips',
    description: 'Delete clips. With ripple, later clips on the same track move left to close the gap.',
    input: z.object({ clipIds: z.array(id).min(1).max(500), ripple: z.boolean().default(false) }),
    run: ({ clipIds, ripple }) =>
      edit(ripple ? 'ops.rippleDelete' : 'ops.deleteClips', (d) => {
        deleteClips(d, new Set(clipIds), ripple);
        return { deleted: clipIds.filter((c) => !findClip(d, c)) };
      }),
  }),

  command({
    name: 'set_speed',
    description: 'Play a video or sound clip faster or slower (0.1 to 10; 2 = twice as fast). The clip gets shorter or longer on the timeline.',
    input: z.object({ clipId: id, speed: z.number().min(0.1).max(10) }),
    run: ({ clipId, speed }) =>
      edit('ops.clipProp', (d) => {
        clipIn(d, clipId);
        if (Number.isNaN(setClipSpeed(d, clipId, speed))) throw new AgentError('Speed applies to video and sound clips only.');
        return clipSummary(d, findClip(d, clipId)!.clip);
      }),
  }),

  command({
    name: 'detach_audio',
    description: "Move the sound of video clips onto their own clips on an audio track (the video goes silent).",
    input: z.object({ clipIds: z.array(id).min(1).max(200) }),
    run: ({ clipIds }) => edit('ops.detachAudio', (d) => ({ audioClipIds: detachAudio(d, clipIds) })),
  }),

  // ---- look
  command({
    name: 'list_effects',
    description: 'Effects (with their parameters and ranges), filter presets and transition kinds that can be added.',
    input: z.object({}),
    readOnly: true,
    run: () => ({
      effects: ADDABLE_EFFECTS.map((k) => ({ kind: k, name: EFFECT_DEFS[k].name, params: EFFECT_DEFS[k].params })),
      filterPresets: LOOK_PRESETS,
      transitions: TRANSITION_KINDS,
    }),
  }),

  command({
    name: 'add_effect',
    description: 'Add an effect (blur, glow, colour correction…; see list_effects) to visual clips, with optional parameter values.',
    input: z.object({
      clipIds: z.array(id).min(1).max(200),
      kind: z.enum(ADDABLE_EFFECTS as [EffectKind, ...EffectKind[]]),
      params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
    }),
    run: ({ clipIds, kind, params }) =>
      edit('ops.addEffect', (d) => {
        const known = defaultParams(kind);
        const unknown = Object.keys(params ?? {}).filter((k) => !(k in known));
        if (unknown.length) throw new AgentError(`Unknown ${kind} parameters: ${unknown.join(', ')}. Known: ${Object.keys(known).join(', ')}.`);
        return clipIds.map((clipId) => {
          const { clip } = clipIn(d, clipId);
          if (!acceptsEffects(clip, clip.assetId ? d.assets[clip.assetId]?.kind : undefined)) throw new AgentError(`Clip ${clipId} cannot take effects.`);
          const e = createEffect(kind, params);
          (clip.effects ??= []).push(e);
          return { clipId, effectId: e.id };
        });
      }),
  }),

  command({
    name: 'update_effect',
    description: "Change an effect's parameters, turn it on or off, or remove it.",
    input: z.object({
      clipId: id,
      effectId: id,
      params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional(),
      enabled: z.boolean().optional(),
      remove: z.boolean().optional(),
    }),
    run: ({ clipId, effectId, params, enabled, remove }) =>
      edit('ops.clipProp', (d) => {
        const { clip } = clipIn(d, clipId);
        const e = clip.effects?.find((x) => x.id === effectId);
        if (!e) throw new AgentError(`Clip ${clipId} has no effect ${effectId}.`);
        if (remove) {
          clip.effects = clip.effects!.filter((x) => x !== e);
          return { removed: effectId };
        }
        if (params) Object.assign(e.params, params);
        if (enabled !== undefined) e.enabled = enabled;
        return e;
      }),
  }),

  command({
    name: 'set_filter',
    description: 'Give visual clips a colour filter preset (see list_effects filterPresets), at `intensity` percent.',
    input: z.object({ clipIds: z.array(id).min(1).max(200), preset: z.enum(LOOK_PRESETS as [string, ...string[]]), intensity: z.number().min(0).max(100).optional() }),
    run: ({ clipIds, preset, intensity }) =>
      edit('ops.addFilter', (d) => {
        for (const clipId of clipIds) {
          const { clip } = clipIn(d, clipId);
          setFilter(clip, preset);
          if (intensity !== undefined) clip.effects!.find((e) => e.kind === 'look')!.params.intensity = intensity;
        }
        return { ok: true };
      }),
  }),

  command({
    name: 'add_transition',
    description: 'Add a transition on the cut between two touching clips of the same track (fromClipId ends where toClipId starts).',
    input: z.object({ fromClipId: id, toClipId: id, kind: z.enum(TRANSITION_KINDS as [string, ...string[]]), duration: z.number().min(0.1).max(3).optional() }),
    run: ({ fromClipId, toClipId, kind, duration }) =>
      edit('ops.addTransition', (d) => {
        const tid = setTransition(d, fromClipId, toClipId, kind as (typeof TRANSITION_KINDS)[number], duration);
        if (!tid) throw new AgentError('Those clips do not touch on one track (the first must end exactly where the second starts).');
        return { transitionId: tid };
      }),
  }),

  command({
    name: 'animate',
    description:
      'Animate a clip with keyframes at timeline times. Values: x, y, scale, rotation, opacity, volume, and for text text.size; shapes shape.width/shape.height. Ease: linear, easeIn, easeOut, easeInOut (default), hold.',
    input: z.object({
      clipId: id,
      keyframes: z
        .array(z.object({ time: seconds, values: z.record(z.string(), z.number()), ease: z.enum(KEY_EASES).optional() }))
        .min(1)
        .max(100),
    }),
    run: ({ clipId, keyframes }) =>
      edit('ops.addKeyframe', (d) => {
        const { clip } = clipIn(d, clipId);
        const tol = keyTolerance(d.settings.fps, keyRate(clip));
        for (const k of keyframes) {
          if (k.time < clip.start - 1e-6 || k.time > clipEnd(clip) + 1e-6)
            throw new AgentError(`Keyframe time ${k.time} is outside the clip (${round(clip.start)}–${round(clipEnd(clip))}).`);
          const s = srcTime(clip, k.time);
          addKeyAt(clip, s, tol);
          const key = clip.keyframes![keyIndexAt(clip, s, tol)];
          Object.assign(key.v, k.values);
          if (k.ease) setKeyEase(clip, clip.keyframes!.indexOf(key), k.ease);
        }
        return { keyframes: clip.keyframes!.length };
      }),
  }),

  command({
    name: 'clear_keyframes',
    description: "Remove a clip's animation, keeping the values it has at its start.",
    input: z.object({ clipId: id }),
    run: ({ clipId }) =>
      edit('ops.clearKeyframes', (d) => {
        const { clip } = clipIn(d, clipId);
        clearKeys(clip, srcTime(clip, clip.start));
        return { ok: true };
      }),
  }),

  // ---- templates and library
  command({
    name: 'list_templates',
    description: 'Ready-made titles, intros, lower thirds and outros that insert_template can add.',
    input: z.object({}),
    readOnly: true,
    run: async () => {
      if (!useTemplates.getState().loaded) await loadServerTemplates();
      return allTemplates(useTemplates.getState().server).map((t) => ({ id: t.id, name: t.name.en, category: t.category, duration: t.duration }));
    },
  }),

  command({
    name: 'insert_template',
    description: 'Insert a template at `start` on new graphics tracks on top. Its placeholder text can then be changed with update_clip.',
    input: z.object({ templateId: id, start: seconds.default(0), persian: z.boolean().default(false).describe('Use the Persian placeholder text, laid out right-to-left') }),
    run: async ({ templateId, start, persian }) => {
      if (!useTemplates.getState().loaded) await loadServerTemplates();
      const tpl = allTemplates(useTemplates.getState().server).find((t) => t.id === templateId);
      if (!tpl) throw new AgentError(`No template ${templateId}. Call list_templates.`);
      return edit('ops.addTemplate', (d) => ({ clipIds: insertTemplate(d, tpl, start, persian) }));
    },
  }),

  command({
    name: 'list_library',
    description: "Files in the server's library: stickers, sounds (sound effects and music), overlays (light leaks, dust) or backgrounds.",
    input: z.object({ kind: z.enum(LIBRARY_KINDS) }),
    readOnly: true,
    run: async ({ kind }) => {
      await loadLibrary(kind);
      const list = useLibrary.getState().lists[kind];
      if (list?.status !== 'ready') return { items: [], note: 'The library is not available on this server.' };
      return { items: list.items.map((i) => ({ path: i.path, name: i.name, category: i.category })) };
    },
  }),

  command({
    name: 'add_library_item',
    description: 'Add a library file (see list_library) to the project and the timeline at `start`. Backgrounds go on the bottom video track.',
    input: z.object({ kind: z.enum(LIBRARY_KINDS), path: z.string().min(1).max(500), start: seconds.default(0) }),
    run: async ({ kind, path, start }) => {
      project();
      await loadLibrary(kind);
      const item = useLibrary.getState().lists[kind]?.items.find((i: LibraryItem) => i.path === path);
      if (!item) throw new AgentError(`No ${kind} item at ${path}. Call list_library.`);
      const assetId = await ensureLibraryAsset(item);
      if (!assetId) throw new AgentError('The file could not be imported.');
      return edit('ops.addClip', (d) => clipSummary(d, findClip(d, placeAsset(d, assetId, start, undefined, kind === 'backgrounds'))!.clip));
    },
  }),

  // ---- subtitles
  command({
    name: 'list_cues',
    description: 'The cues (start, end, text) of a subtitle track, or of the first one.',
    input: z.object({ trackId: id.optional() }),
    readOnly: true,
    run: ({ trackId }) => {
      const p = project();
      const t = trackId ? p.subtitleTracks.find((x) => x.id === trackId) : p.subtitleTracks[0];
      if (!t) throw new AgentError(trackId ? `No subtitle track ${trackId}.` : 'The project has no subtitle track.');
      return { trackId: t.id, language: t.language, cues: t.cues.map((c) => ({ id: c.id, start: round(c.start), end: round(c.end), text: c.text })) };
    },
  }),

  command({
    name: 'add_subtitles',
    description:
      'Create a subtitle track from cues you write or from SRT/WebVTT text. Use it for scripted captions; auto_captions transcribes the audio instead.',
    input: z.object({
      language: z.string().min(2).max(10).default('en'),
      cues: z.array(z.object({ start: seconds, end: seconds, text: z.string().max(500) })).max(5000).optional(),
      srt: z.string().max(500_000).optional().describe('SRT or WebVTT file text, instead of cues'),
    }),
    run: ({ language, cues, srt }) => {
      const parsed = srt ? parseSubtitles(srt.trimStart().startsWith('WEBVTT') ? 'subs.vtt' : 'subs.srt', srt).cues : (cues ?? []);
      if (!parsed.length) throw new AgentError('No cues given (or the SRT text had none).');
      const rtl = parsed.slice(0, 10).some((c) => detectRtl(c.text));
      const track = { ...createSubtitleTrack(language), rtl };
      track.cues = parsed.filter((c) => c.end > c.start).sort((a, b) => a.start - b.start).map((c) => ({ id: newId(), start: c.start, end: c.end, text: c.text }));
      return edit('ops.importSubtitles', (d) => {
        d.subtitleTracks.push(track);
        return { trackId: track.id, cues: track.cues.length };
      });
    },
  }),

  command({
    name: 'edit_cues',
    description: 'Change, add or delete subtitle cues. Changes: {cueId, text?, start?, end?}; additions: {trackId, start, end, text}; deletions: cue ids.',
    input: z.object({
      change: z.array(z.object({ cueId: id, text: z.string().max(500).optional(), start: seconds.optional(), end: seconds.optional() })).max(2000).optional(),
      add: z.array(z.object({ trackId: id, start: seconds, end: seconds, text: z.string().max(500) })).max(2000).optional(),
      delete: z.array(id).max(5000).optional(),
    }),
    run: (a) =>
      edit('ops.cueText', (d) => {
        for (const c of a.change ?? []) {
          if (!findCue(d, c.cueId)) throw new AgentError(`No cue ${c.cueId}.`);
          if (c.text !== undefined) setCueText(d, c.cueId, c.text);
          if (c.start !== undefined) setCueEdge(d, c.cueId, 'start', c.start);
          if (c.end !== undefined) setCueEdge(d, c.cueId, 'end', c.end);
        }
        const added: (ID | null)[] = [];
        for (const c of a.add ?? []) {
          const t = d.subtitleTracks.find((x) => x.id === c.trackId);
          if (!t) throw new AgentError(`No subtitle track ${c.trackId}.`);
          added.push(addCue(t, c.start, c.text, Math.max(0.2, c.end - c.start)));
        }
        if (a.delete?.length) deleteCues(d, new Set(a.delete));
        return { added };
      }),
  }),

  command({
    name: 'auto_captions',
    description:
      'Transcribe the speech in the project into a new subtitle track, in the browser with Whisper. Takes from seconds to minutes: poll job_status. Model: base is fast, large-v3-turbo is best (needs a strong computer).',
    input: z.object({ model: z.enum(WHISPER_SIZES).default('base'), language: z.string().min(2).max(10).optional().describe('e.g. fa, en; omitted: detected') }),
    run: ({ model, language }) => {
      project();
      const stage = useStt.getState().stage;
      if (stage === 'extracting' || stage === 'loading' || stage === 'transcribing') throw new AgentError('Captions are already being made; poll job_status.');
      void startAutoSubtitles({ model, language: language ?? null, selectedOnly: false });
      return started('auto_captions');
    },
  }),

  command({
    name: 'translate_captions',
    description: 'Translate an English subtitle track into a new Persian one, in the browser (Pro plan). Poll job_status.',
    input: z.object({ trackId: id, quality: z.enum(['standard', 'precise']).default('standard') }),
    run: ({ trackId, quality }) => {
      const access = aiAccess(useAccount.getState().me);
      if (access !== 'ok') throw new AgentError(access === 'login' ? 'The user must log in to Vidora first.' : 'Translation needs the Pro plan.');
      if (!project().subtitleTracks.some((t) => t.id === trackId)) throw new AgentError(`No subtitle track ${trackId}.`);
      void translateTrack(trackId, quality);
      return started('translate_captions');
    },
  }),

  // ---- seeing and finishing
  command({
    name: 'snapshot',
    description: 'A picture of the video at timeline time `time` (also moves the playhead there). Use it to check how an edit looks.',
    input: z.object({ time: seconds, maxSize: z.number().int().min(160).max(1280).default(640) }),
    readOnly: true,
    run: async ({ time, maxSize }): Promise<ToolResult> => {
      project();
      useTransport.getState().pause();
      useTransport.getState().seek(time);
      const blob = await playbackEngine.snapshot(maxSize);
      if (!blob) throw new AgentError('The preview could not be drawn.');
      return { content: [{ type: 'image', data: await blobToBase64(blob), mimeType: blob.type }] };
    },
  }),

  command({
    name: 'job_status',
    description: 'Progress of auto_captions, translate_captions and export.',
    input: z.object({}),
    readOnly: true,
    run: () => {
      const stt = useStt.getState();
      const tr = useTranslate.getState();
      const ex = useExport.getState();
      return {
        captions: { stage: stt.stage, progress: round(stt.progress), ...(stt.error && { error: stt.error, detail: stt.detail }), ...(stt.created !== undefined && { cuesCreated: stt.created }) },
        translation: { stage: tr.stage, progress: round(tr.progress) },
        export: {
          stage: ex.stage,
          dialogOpen: ex.open,
          progress: round(ex.progress),
          ...(ex.error && { error: ex.error }),
          ...(ex.result && { file: ex.result.name, bytes: ex.result.bytes }),
        },
      };
    },
  }),

  command({
    name: 'request_export',
    description:
      "Open the export window with these settings. The user must press Export themselves (the browser asks where to save). Free accounts: up to 60 s and a watermark. Poll job_status.",
    input: z.object({
      format: z.enum(EXPORT_FORMATS as [ExportSettings['format'], ...ExportSettings['format'][]]).default('mp4'),
      resolution: z.union([z.literal(240), z.literal(360), z.literal(480), z.literal(720), z.literal(1080)]).optional(),
      quality: z.enum(['low', 'medium', 'high']).optional(),
      burnSubtitles: z.boolean().optional(),
    }),
    run: (s) => {
      project();
      useExport.setState({ open: true, preset: s });
      return { opened: true, next: 'Tell the user to check the settings and press Export; then poll job_status.' };
    },
  }),

  command({
    name: 'undo',
    description: 'Undo the last change (the agent’s or the user’s).',
    input: z.object({}),
    run: () => {
      useProjectStore.getState().undo();
      return { ok: true };
    },
  }),

  command({
    name: 'redo',
    description: 'Redo the last undone change.',
    input: z.object({}),
    run: () => {
      useProjectStore.getState().redo();
      return { ok: true };
    },
  }),
];

const byName = new Map(COMMANDS.map((c) => [c.name, c]));

/** The MCP tool list (name, description, JSON Schema input, hints). */
export function agentToolList() {
  return COMMANDS.map((c) => ({
    name: c.name,
    description: c.description,
    inputSchema: z.toJSONSchema(c.input, { io: 'input' }),
    annotations: { readOnlyHint: !!c.readOnly },
  }));
}

/** Run one tool call from the agent. Never throws: failures come back as an error result. */
export async function runCommand(name: string, args: unknown): Promise<ToolResult> {
  const c = byName.get(name);
  if (!c) return { isError: true, content: [{ type: 'text', text: `Unknown tool ${name}. This Vidora tab may be out of date; reload it.` }] };
  const parsed = c.input.safeParse(args ?? {});
  if (!parsed.success) return { isError: true, content: [{ type: 'text', text: `Invalid arguments:\n${z.prettifyError(parsed.error)}` }] };
  try {
    const out = await c.run(parsed.data);
    if (out && typeof out === 'object' && 'content' in out) return out as ToolResult;
    return { content: [{ type: 'text', text: JSON.stringify(out ?? { ok: true }) }] };
  } catch (e) {
    if (e instanceof AgentError) return { isError: true, content: [{ type: 'text', text: e.message }] };
    console.error('agent command', name, e);
    return { isError: true, content: [{ type: 'text', text: `${name} failed: ${e instanceof Error ? e.message : String(e)}` }] };
  }
}
