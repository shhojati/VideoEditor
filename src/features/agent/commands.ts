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
import { defaultShape, pathShape, TEXT_STYLE_DEFAULTS } from '../../model/overlays';
import { MAX_PATH_DATA, parsePathData, PathDataError, pointsPath, toPathData } from '../../lib/svgPath';
import { breakApart, makeCompound } from '../../model/sequences';
import { keyRate } from '../../model/remap';
import { addCue, deleteCues, findCue, setCueEdge, setCueText } from '../../model/subtitles';
import { insertTemplate } from '../../model/templates';
import {
  addShapeClip,
  addSolidClip,
  ARRANGE_ACTIONS,
  arrangeClip,
  type ClipRef,
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
import type { BlendMode, Clip, EffectKind, ID, LibraryKind, MaskVertex, Project, ShapeKind, ShapeProps, TextAnimKind, Track } from '../../model/types';
import { keyTolerance, pathBounds } from '../../model/masks';
import { useAccount } from '../../store/account';
import { currentProject, useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { aiAccess } from '../account/policy';
import { useExport } from '../export/exportService';
import { loadLibrary, ensureLibraryAsset, useLibrary } from '../library/libraryService';
import { groupPivot } from '../timeline/compoundActions';
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
const color = z.string().regex(/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/, 'a colour like #ff8800, or #ff880080 with alpha');
const LIBRARY_KINDS = ['stickers', 'sounds', 'overlays', 'backgrounds'] as const satisfies readonly LibraryKind[];
const SHAPE_KINDS = ['rectangle', 'square', 'circle', 'oval', 'triangle', 'star', 'polygon', 'line', 'path'] as const satisfies readonly ShapeKind[];
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
    width: z.number().min(1).max(10000).describe('Pixels. For a path: scales the outline to this width'),
    height: z.number().min(1).max(10000),
    fill: color.nullable().describe('null: no fill'),
    stroke: color.nullable().describe('null: no outline'),
    strokeWidth: z.number().min(0).max(500),
    fillOpacity: z.number().min(0).max(1),
    strokeOpacity: z.number().min(0).max(1),
    cornerRadius: z.number().min(0).max(5000),
    dash: z.enum(['solid', 'dash', 'dot']),
    lineCap: z.enum(['butt', 'round', 'square']).describe('Ends of lines and open paths'),
    lineJoin: z.enum(['miter', 'round', 'bevel']).describe('Corners of outlines'),
    feather: z.number().min(0).max(500).describe('Soft edge of the fill, pixels'),
    gradient: z
      .object({ kind: z.enum(['linear', 'radial']), to: color, angle: z.number().min(-360).max(360).default(90).describe('Linear only, degrees') })
      .nullable()
      .describe('Fill from `fill` to `to`; null removes it'),
    shadow: z
      .object({ color, blur: z.number().min(0).max(200).default(12), x: z.number().min(-1000).max(1000).default(0), y: z.number().min(-1000).max(1000).default(6) })
      .nullable()
      .describe('Drop shadow, pixels; colour may have alpha (#00000080). null removes it'),
    sides: z.number().int().min(3).max(12).describe('Polygon'),
    starPoints: z.number().int().min(3).max(20).describe('Star'),
    innerRadius: z.number().min(0.05).max(0.95).describe('Star, fraction of the outer radius'),
  })
  .partial();

const pathInput = z
  .object({
    d: z
      .string()
      .min(1)
      .max(MAX_PATH_DATA)
      .describe(
        'kind path: SVG path data (M L H V C S Q T A Z, absolute or lower-case relative) in project pixels. (0,0) is the point at transform x/y, so parts drawn with the same transform line up. One subpath (one M) per shape; Z closes it (only closed paths are filled).',
      ),
    points: z
      .array(z.object({ x: z.number().min(-20000).max(20000), y: z.number().min(-20000).max(20000) }))
      .min(2)
      .max(2000)
      .describe('kind path, instead of d: points in pixels (same origin as d), joined by straight lines, or by a curve through them with smooth'),
    smooth: z.boolean().describe('points: a smooth curve through the points'),
    closed: z.boolean().describe('points: close the outline (default true)'),
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

/** A clip inside a group (compound clip) at any depth: where it is, and inner time + offset = timeline time. */
function findNested(p: Project, clipId: ID, tracks: Track[] = p.tracks, offset = 0, depth = 0): { ref: ClipRef; tracks: Track[]; offset: number } | undefined {
  if (depth > 8) return undefined;
  for (const t of tracks)
    for (const c of t.clips) {
      const seq = c.sequenceId ? p.sequences?.[c.sequenceId] : undefined;
      if (!seq) continue;
      const inner = offset + c.start - c.inPoint;
      const ref = findClip({ ...p, tracks: seq.tracks }, clipId);
      if (ref) return { ref, tracks: seq.tracks, offset: inner };
      const deeper = findNested(p, clipId, seq.tracks, inner, depth + 1);
      if (deeper) return deeper;
    }
  return undefined;
}

/**
 * A clip by id on the open timeline, or with `nested` also inside groups. `tracks` is the timeline
 * that holds it; `offset` turns its times into timeline times.
 */
function clipIn(p: Project, clipId: ID, nested = false): ClipRef & { tracks: Track[]; offset: number } {
  const top = findClip(p, clipId);
  const found = top ? { ref: top, tracks: p.tracks, offset: 0 } : findNested(p, clipId);
  if (!found) throw new AgentError(`No clip with id ${clipId}. Call get_project for the current ids.`);
  if (!top && !nested) throw new AgentError(`Clip ${clipId} is inside a group (compound clip). update_clip, animate and effects work inside groups; for this, ungroup it first.`);
  if (found.ref.track.locked) throw new AgentError(`Clip ${clipId} is on a locked track.`);
  return { ...found.ref, tracks: found.tracks, offset: found.offset };
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

/** `offset`: for a clip inside a group, its inner times + offset are timeline times. */
function clipSummary(p: Project, c: Clip, offset = 0) {
  const asset = c.assetId ? p.assets[c.assetId] : undefined;
  const seq = c.sequenceId ? p.sequences?.[c.sequenceId] : undefined;
  return {
    id: c.id,
    type: clipType(p, c),
    start: round(c.start + offset),
    end: round(clipEnd(c) + offset),
    ...(seq && { name: seq.name, children: seq.tracks.flatMap((t) => t.clips.map((x) => x.id)).slice(0, 200) }),
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

/** Shape style from the agent onto a shape (width/height of paths are handled by the caller). */
function applyShape(s: ShapeProps, { fill, stroke, lineCap, lineJoin, gradient, shadow, starPoints, ...rest }: z.infer<typeof shapeStyle>) {
  Object.assign(s, rest);
  if (fill !== undefined) s.fill = fill ?? undefined;
  if (stroke !== undefined) s.stroke = stroke ?? undefined;
  if (stroke && rest.strokeWidth === undefined && !s.strokeWidth) s.strokeWidth = 6;
  if (lineCap) s.cap = lineCap;
  if (lineJoin) s.join = lineJoin;
  if (starPoints) s.points = starPoints;
  if (gradient !== undefined) s.gradient = gradient ?? undefined;
  if (shadow) Object.assign(s, { shadowColor: shadow.color, shadowBlur: shadow.blur, shadowX: shadow.x, shadowY: shadow.y });
  else if (shadow === null) for (const k of ['shadowColor', 'shadowBlur', 'shadowX', 'shadowY'] as const) delete s[k];
}

/** The outline from d or points (absolute pixels, origin at the shape's anchor point). */
function pathFrom({ d, points, smooth, closed }: z.infer<typeof pathInput>): { points: MaskVertex[]; closed: boolean } {
  if (d !== undefined) {
    let subs;
    try {
      subs = parsePathData(d);
    } catch (e) {
      throw e instanceof PathDataError ? new AgentError(`Invalid d: ${e.message}.`) : e;
    }
    if (subs.length > 1)
      throw new AgentError(`d has ${subs.length} subpaths (one per M); a shape holds one. Add one path shape per subpath with the same transform (they line up) and group them with group_clips.`);
    if (subs[0].points.length < 2) throw new AgentError('d needs at least two points.');
    return subs[0];
  }
  if (points) return { points: pointsPath(points, closed ?? true, !!smooth), closed: closed ?? true };
  throw new AgentError('A path shape needs d (SVG path data) or points.');
}

/** Scale an outline (about its origin) so its bounding box is width × height (one given: in proportion). */
function fitPath(points: MaskVertex[], width?: number, height?: number): MaskVertex[] {
  if (!width && !height) return points;
  const b = pathBounds(points);
  const fx = width && b.width > 1e-6 ? width / b.width : undefined;
  const fy = height && b.height > 1e-6 ? height / b.height : undefined;
  const sx = fx ?? fy ?? 1;
  const sy = fy ?? fx ?? 1;
  return points.map(([x, y, ix, iy, ox, oy]): MaskVertex => [x * sx, y * sy, ix * sx, iy * sy, ox * sx, oy * sy]);
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
    description: 'Every setting of one clip (transform, text, shape, audio, effects with params, keyframes), also inside groups. Path shapes include their outline as SVG path data `d` (centred on the shape position).',
    input: z.object({ clipId: id }),
    readOnly: true,
    run: ({ clipId }) => {
      const p = project();
      const ref = findClip(p, clipId) ?? findNested(p, clipId)?.ref;
      if (!ref) throw new AgentError(`No clip with id ${clipId}.`);
      const s = ref.clip.shape;
      return {
        trackId: ref.track.id,
        type: clipType(p, ref.clip),
        ...(!findClip(p, clipId) && { insideGroup: true }),
        ...(s?.kind === 'path' && s.path && { d: toPathData(s.path.value, !!s.closed) }),
        ...JSON.parse(JSON.stringify(ref.clip)),
      };
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
    description:
      'Add a vector shape on a graphics track (a new track on top when the time is taken). Kinds: rectangle, square, circle, oval, triangle, star, polygon, line, and path: any outline with curves from SVG path data `d` or `points` (faces, hair, objects). Sizes are project pixels. Colours may have alpha (#RRGGBBAA). Draw a figure as several paths with the same transform, then group_clips and reorder_clip.',
    input: shapeStyle.extend({ kind: z.enum(SHAPE_KINDS), start: seconds.default(0), duration: z.number().positive().max(3600).optional(), transform: transform.optional() }).merge(pathInput),
    run: ({ kind, start, duration, transform: tr, d: pathData, points, smooth, closed, ...style }) =>
      edit('ops.addShape', (d) => {
        if (kind !== 'path' && (pathData !== undefined || points)) throw new AgentError('d and points are for kind "path".');
        let shape = defaultShape(kind);
        let centre = { x: 0, y: 0 };
        const { width, height, ...look } = style;
        if (kind === 'path') {
          const outline = pathFrom({ d: pathData, points, smooth, closed });
          ({ shape, centre } = pathShape(fitPath(outline.points, width, height), outline.closed));
          // As in SVG: what is given is drawn, nothing else.
          if (look.fill !== undefined || look.stroke !== undefined) {
            shape.fill = undefined;
            shape.stroke = undefined;
          }
        } else Object.assign(shape, width !== undefined && { width }, height !== undefined && { height });
        applyShape(shape, look);
        const clipId = addShapeClip(d, start, shape);
        const c = findClip(d, clipId)!.clip;
        if (tr) Object.assign(c.transform, tr);
        if (centre.x || centre.y) {
          // The outline's middle, from its origin at the transform position (turned and scaled with it).
          const { width: W, height: H } = d.settings;
          const a = (c.transform.rotation * Math.PI) / 180;
          const k = c.transform.scale;
          c.transform.x += ((centre.x * Math.cos(a) - centre.y * Math.sin(a)) * k) / W;
          c.transform.y += ((centre.x * Math.sin(a) + centre.y * Math.cos(a)) * k) / H;
        }
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
      'Change a clip (also one inside a group): length, transform (position/scale/rotation/opacity), blend mode, sound (volume 0..2, fades), text style or shape style. shape.d / shape.points replace a shape\'s outline (it becomes a path), centred where the shape is now. On a clip with keyframes, transform and volume changes land in a keyframe at timeline time `time` (default the clip start).',
    input: z.object({
      clipId: id,
      duration: z.number().positive().optional(),
      transform: transform.optional(),
      blend: z.enum(BLENDS).optional(),
      volume: z.number().min(0).max(2).optional(),
      fadeIn: z.number().min(0).max(60).optional(),
      fadeOut: z.number().min(0).max(60).optional(),
      text: textStyle.optional(),
      shape: shapeStyle.merge(pathInput).optional(),
      time: seconds.optional(),
    }),
    run: ({ clipId, duration, transform: tr, blend, volume, fadeIn, fadeOut, text, shape, time }) =>
      edit('ops.clipProp', (d) => {
        const { clip, offset } = clipIn(d, clipId, true);
        if (text && !clip.text) throw new AgentError('That clip is not a text clip.');
        if (shape && !clip.shape) throw new AgentError('That clip is not a shape clip.');
        const values: Record<string, number> = { ...tr, ...(volume !== undefined && { volume }) };
        if (!clip.keyframes?.length) writeProps(clip, values);
        else if (Object.keys(values).length) {
          const s = srcTime(clip, Math.min(clipEnd(clip), Math.max(clip.start, time === undefined ? clip.start : time - offset)));
          const tol = keyTolerance(d.settings.fps, keyRate(clip));
          addKeyAt(clip, s, tol);
          Object.assign(clip.keyframes[keyIndexAt(clip, s, tol)].v, values);
        }
        if (blend) clip.blend = blend;
        if (fadeIn !== undefined) (clip.text ?? clip.shape ?? clip.audio).fadeIn = fadeIn;
        if (fadeOut !== undefined) (clip.text ?? clip.shape ?? clip.audio).fadeOut = fadeOut;
        if (text) applyText(clip, text);
        if (shape && clip.shape) {
          const { d: pathData, points, smooth, closed, width, height, ...look } = shape;
          const s = clip.shape;
          if (pathData !== undefined || points) {
            const outline = pathFrom({ d: pathData, points, smooth, closed });
            const next = pathShape(fitPath(outline.points, width, height), outline.closed).shape;
            Object.assign(s, { kind: 'path', path: next.path, closed: next.closed, width: next.width, height: next.height });
            if (next.closed) s.fill ??= next.fill;
            else if (!s.stroke) Object.assign(s, { stroke: next.stroke, strokeWidth: s.strokeWidth || next.strokeWidth });
          } else if (s.kind === 'path' && s.path && (width || height)) {
            const scaled = (v: MaskVertex[]) => fitPath(v, width && (width / s.width) * pathBounds(v).width, height && (height / s.height) * pathBounds(v).height);
            s.path = { value: scaled(s.path.value), ...(s.path.keys && { keys: s.path.keys.map((k) => ({ t: k.t, v: scaled(k.v) })) }) };
            if (width) s.width = width;
            if (height) s.height = height;
          } else Object.assign(s, width !== undefined && { width }, height !== undefined && { height });
          applyShape(s, look);
        }
        if (duration) {
          if (offset || !findClip(d, clipId)) clip.duration = Math.max(0.1, duration);
          else setDuration(d, clipId, duration);
        }
        return clipSummary(d, clip, offset);
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
    name: 'reorder_clip',
    description:
      "Change the layer order of a visual clip: what it is drawn in front of or behind (e.g. arms in front of the head). action bringToFront / sendToBack: past every clip it overlaps in time; forward / backward: one step. Or trackIndex (from get_project) to put it on that track. Inside a group the order is among the group's clips.",
    input: z.object({ clipId: id, action: z.enum(ARRANGE_ACTIONS).optional(), trackIndex: z.number().int().min(0).max(1000).optional() }),
    run: ({ clipId, action, trackIndex }) =>
      edit('ops.arrange', (d) => {
        if ((action === undefined) === (trackIndex === undefined)) throw new AgentError('Give either action or trackIndex.');
        const { clip, tracks, offset } = clipIn(d, clipId, true);
        const view = { ...d, tracks };
        if (action) {
          if (!arrangeClip(view, clipId, action))
            throw new AgentError('Nothing to move past: no visual clip overlaps it in time on that side (or it is a sound clip).');
        } else {
          const target = tracks[trackIndex!];
          if (!target) throw new AgentError(`No track at index ${trackIndex}.`);
          if (!moveClips(view, [{ clipId, trackId: target.id, start: clip.start }]))
            throw new AgentError('Cannot put it on that track: a different kind of track, locked, or another clip is in the way at that time.');
        }
        return { ...clipSummary(d, clip, offset), trackIndex: tracks.findIndex((t) => t.clips.some((c) => c.id === clipId)) };
      }),
  }),

  command({
    name: 'group_clips',
    description:
      'Group clips (e.g. the parts of a drawn character) into one compound clip that moves, scales, turns and animates as one object about the centre of its parts. The parts keep their ids: get_clip, update_clip, animate, reorder_clip and effects still work on them inside the group.',
    input: z.object({ clipIds: z.array(id).min(2).max(200), name: z.string().min(1).max(100).optional() }),
    run: ({ clipIds, name }) =>
      edit('ops.group', (d) => {
        for (const c of clipIds) clipIn(d, c);
        const n = Object.keys(d.sequences ?? {}).length + 1;
        const groupId = makeCompound(d, clipIds, name ?? `Group ${n}`, { pivot: groupPivot(d, clipIds, useTransport.getState().time) });
        if (!groupId) throw new AgentError('Could not group them: it needs at least two clips on unlocked tracks.');
        return clipSummary(d, findClip(d, groupId)!.clip);
      }),
  }),

  command({
    name: 'ungroup',
    description: "Break a group (compound clip) apart: its clips go back on the timeline where they are drawn, with the group's position, turn, scale and opacity folded into them.",
    input: z.object({ groupId: id }),
    run: ({ groupId }) =>
      edit('ops.breakApart', (d) => {
        const { clip } = clipIn(d, groupId);
        if (!clip.sequenceId) throw new AgentError(`Clip ${groupId} is not a group.`);
        const inner = d.sequences?.[clip.sequenceId]?.tracks.flatMap((t) => t.clips.map((c) => c.id)) ?? [];
        const done = breakApart(d, groupId);
        return {
          clipIds: inner.filter((c) => findClip(d, c)),
          ...(done === 'approx' && { warning: "The group's own keyframes, effects, masks, blend mode or crop were not carried over to its clips." }),
        };
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
          const { clip } = clipIn(d, clipId, true);
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
        const { clip } = clipIn(d, clipId, true);
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
      'Animate a clip (also a part inside a group, or a whole group) with keyframes at timeline times. Values: x, y, scale, rotation, opacity, volume, and for text text.size; shapes shape.width/shape.height. Ease: linear, easeIn, easeOut, easeInOut (default), hold.',
    input: z.object({
      clipId: id,
      keyframes: z
        .array(z.object({ time: seconds, values: z.record(z.string(), z.number()), ease: z.enum(KEY_EASES).optional() }))
        .min(1)
        .max(100),
    }),
    run: ({ clipId, keyframes }) =>
      edit('ops.addKeyframe', (d) => {
        const { clip, offset } = clipIn(d, clipId, true);
        const tol = keyTolerance(d.settings.fps, keyRate(clip));
        for (const k of keyframes) {
          const t = k.time - offset;
          if (t < clip.start - 1e-6 || t > clipEnd(clip) + 1e-6)
            throw new AgentError(`Keyframe time ${k.time} is outside the clip (${round(clip.start + offset)}–${round(clipEnd(clip) + offset)}).`);
          const s = srcTime(clip, t);
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
        const { clip } = clipIn(d, clipId, true);
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
