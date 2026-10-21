// Clip keyframes, InShot style: each keyframe is a snapshot of the clip's animatable values
// (position, scale, rotation, opacity, volume, shape size, voice effect, numeric effect settings) at a source
// time; in between, values travel with the earlier keyframe's ease. Once a clip has keyframes,
// every edit at the playhead lands in a keyframe there (added when missing). Pure.
import { EFFECT_DEFS, defaultParams } from './effects';
import type { Clip, ClipKeyframe, KeyEase } from './types';
import { keyTimeAt, keyToTimeline } from './remap';

export type KeyValues = Record<string, number>;

export const KEY_EASES = ['linear', 'easeIn', 'easeOut', 'easeInOut', 'hold'] as const satisfies readonly KeyEase[];
export const DEFAULT_EASE: KeyEase = 'easeInOut';

const cube = (f: number) => f * f * f;
const EASE: Record<KeyEase, (f: number) => number> = {
  linear: (f) => f,
  easeIn: cube,
  easeOut: (f) => 1 - cube(1 - f),
  easeInOut: (f) => (f < 0.5 ? 4 * cube(f) : 1 - cube(2 - 2 * f) / 2),
  hold: () => 0,
};

export const easeAt = (ease: KeyEase | undefined, f: number) => EASE[ease ?? DEFAULT_EASE](Math.min(1, Math.max(0, f)));

/** Keyframes run on the clip's key clock (source time; local time for a freeze frame), see remap.ts. */
export const srcTime = keyTimeAt;
export const timelineTime = keyToTimeline;

export { keyTolerance } from './masks';

// ---- properties -----------------------------------------------------------------------------------

const fxProp = (effectId: string, param: string) => `fx.${effectId}.${param}`;

/** Every animatable value of the clip as it is stored (no keyframes applied). */
export function readProps(clip: Clip): KeyValues {
  const tr = clip.transform;
  const v: KeyValues = { x: tr.x, y: tr.y, scale: tr.scale, rotation: tr.rotation, opacity: tr.opacity, volume: clip.audio.volume };
  if (clip.shape) {
    v['shape.width'] = clip.shape.width;
    v['shape.height'] = clip.shape.height;
  }
  const { voice, space } = clip.audio;
  if (voice) {
    v['voice.pitch'] = voice.pitch;
    v['voice.amount'] = voice.amount;
  }
  if (space) v['space.mix'] = space.mix;
  for (const e of clip.effects ?? [])
    for (const [k, x] of Object.entries({ ...defaultParams(e.kind), ...e.params })) if (typeof x === 'number') v[fxProp(e.id, k)] = x;
  return v;
}

/** Settings with whole-number steps (levels, counts…) stay whole while animating. */
function isWholeParam(kind: keyof typeof EFFECT_DEFS, key: string) {
  const spec = EFFECT_DEFS[kind].params.find((p) => p.key === key);
  return spec?.type === 'number' && spec.step !== undefined && spec.step >= 1 && Number.isInteger(spec.step);
}

/** Write one value into the clip (mutates it). Unknown properties are ignored. */
export function writeProp(clip: Clip, prop: string, v: number) {
  switch (prop) {
    case 'x':
    case 'y':
    case 'scale':
    case 'rotation':
    case 'opacity':
      clip.transform[prop] = v;
      return;
    case 'volume':
      clip.audio.volume = v;
      return;
    case 'shape.width':
      if (clip.shape) clip.shape.width = v;
      return;
    case 'shape.height':
      if (clip.shape) clip.shape.height = v;
      return;
    case 'voice.pitch':
      if (clip.audio.voice) clip.audio.voice.pitch = v;
      return;
    case 'voice.amount':
      if (clip.audio.voice) clip.audio.voice.amount = v;
      return;
    case 'space.mix':
      if (clip.audio.space) clip.audio.space.mix = v;
      return;
  }
  if (!prop.startsWith('fx.')) return;
  const dot = prop.indexOf('.', 3);
  const id = prop.slice(3, dot);
  const key = prop.slice(dot + 1);
  const e = clip.effects?.find((x) => x.id === id);
  if (e) e.params[key] = isWholeParam(e.kind, key) ? Math.round(v) : v;
}

export function writeProps(clip: Clip, values: KeyValues) {
  for (const [p, v] of Object.entries(values)) writeProp(clip, p, v);
}

// ---- resolving --------------------------------------------------------------------------------------

/** A property at source time s from the keyframes that have it; undefined when none does. */
export function keyedValue(keys: readonly ClipKeyframe[], prop: string, s: number): number | undefined {
  let prev: ClipKeyframe | undefined;
  let next: ClipKeyframe | undefined;
  for (const k of keys) {
    if (!(prop in k.v)) continue;
    if (k.t <= s) prev = k;
    else {
      next = k;
      break;
    }
  }
  if (!prev) return next?.v[prop];
  if (!next) return prev.v[prop];
  const a = prev.v[prop];
  return a + (next.v[prop] - a) * easeAt(prev.ease, (s - prev.t) / (next.t - prev.t || 1));
}

const keyedProps = (keys: readonly ClipKeyframe[]) => new Set(keys.flatMap((k) => Object.keys(k.v)));

/** Every animatable value at source time s, keyframes applied. */
export function propsAt(clip: Clip, s: number): KeyValues {
  const out = readProps(clip);
  const keys = clip.keyframes;
  if (!keys?.length) return out;
  for (const p of keyedProps(keys)) if (p in out) out[p] = keyedValue(keys, p, s)!;
  return out;
}

/**
 * The clip as it looks at timeline time t: keyframed values written in, keyframes dropped (so the
 * result can be edited or passed on like a plain clip). The same object when it has no keyframes.
 */
export function keyedClip(clip: Clip, t: number): Clip {
  const keys = clip.keyframes;
  if (!keys?.length) return clip;
  const out: Clip = {
    ...clip,
    transform: { ...clip.transform },
    audio: { ...clip.audio, ...(clip.audio.voice && { voice: { ...clip.audio.voice } }), ...(clip.audio.space && { space: { ...clip.audio.space } }) },
    shape: clip.shape && { ...clip.shape },
    effects: clip.effects?.map((e) => ({ ...e, params: { ...e.params } })),
  };
  delete out.keyframes;
  const s = srcTime(clip, t);
  for (const p of keyedProps(keys)) writeProp(out, p, keyedValue(keys, p, s)!);
  return out;
}

export const keyedTransform = (clip: Clip, t: number) => (clip.keyframes?.length ? keyedClip(clip, t).transform : clip.transform);

/** Volume at timeline time t (before fades). */
export function volumeAt(clip: Clip, t: number) {
  const keys = clip.keyframes;
  const v = keys?.length ? keyedValue(keys, 'volume', srcTime(clip, t)) : undefined;
  return v ?? clip.audio.volume;
}

/** The loudest the clip ever gets (silent clips are skipped by players and mixers). */
export function peakVolume(clip: Clip) {
  let v = clip.audio.volume;
  const keyed = clip.keyframes?.filter((k) => 'volume' in k.v);
  if (keyed?.length) v = Math.max(...keyed.map((k) => k.v.volume));
  return v;
}

/** Timeline interval over which keyframes change the volume, if any. */
export function volumeRamp(clip: Clip): [number, number] | undefined {
  const keyed = clip.keyframes?.filter((k) => 'volume' in k.v);
  if (!keyed || keyed.length < 2) return undefined;
  const a = timelineTime(clip, keyed[0].t);
  const b = timelineTime(clip, keyed[keyed.length - 1].t);
  return b > a ? [a, b] : undefined;
}

// ---- editing ----------------------------------------------------------------------------------------

export const keyIndexAt = (clip: Clip, s: number, tol: number) => clip.keyframes?.findIndex((k) => Math.abs(k.t - s) <= tol) ?? -1;

function insertKey(keys: ClipKeyframe[], key: ClipKeyframe) {
  const j = keys.findIndex((k) => k.t > key.t);
  keys.splice(j < 0 ? keys.length : j, 0, key);
}

/** The ◆+ button: record every value at source time s as a keyframe (the clip's first one starts the animation). */
export function addKeyAt(clip: Clip, s: number, tol: number) {
  const i = keyIndexAt(clip, s, tol);
  if (i >= 0) return;
  const v = propsAt(clip, s);
  if (!clip.keyframes) clip.keyframes = [];
  insertKey(clip.keyframes, { t: s, v });
}

/** Remove one keyframe. The last one gone ends the animation, keeping the values it had. */
export function removeKey(clip: Clip, index: number) {
  const keys = clip.keyframes;
  if (!keys?.[index]) return;
  if (keys.length === 1) {
    clearKeys(clip, keys[0].t);
    return;
  }
  keys.splice(index, 1);
}

/** Drop the animation, keeping the values as they are at source time s. */
export function clearKeys(clip: Clip, s: number) {
  if (!clip.keyframes) return;
  writeProps(clip, propsAt(clip, s));
  delete clip.keyframes;
}

export function setKeyEase(clip: Clip, index: number, ease: KeyEase) {
  const k = clip.keyframes?.[index];
  if (!k) return;
  if (ease === DEFAULT_EASE) delete k.ease;
  else k.ease = ease;
}

/** Retime a keyframe (keeps the list sorted). Refused when it would land on another keyframe. Returns its new index. */
export function moveKey(clip: Clip, index: number, s: number, tol: number): number {
  const keys = clip.keyframes;
  const k = keys?.[index];
  if (!keys || !k) return index;
  if (keys.some((x, i) => i !== index && Math.abs(x.t - s) <= tol)) return index;
  keys.splice(index, 1);
  k.t = s;
  insertKey(keys, k);
  return keys.indexOf(k);
}

const SAME = 1e-9;

/**
 * Apply an edit as seen at source time s. Without keyframes the edit applies as it is. With
 * keyframes, the values that change are stored in a keyframe at s (added with every current value
 * when missing); keyframes without a changed property get its value at their time, so nothing
 * else moves. Edits of anything that is not animatable apply to the whole clip.
 */
export function editAt(clip: Clip, s: number, tol: number, recipe: (c: Clip) => void) {
  const keys = clip.keyframes;
  if (!keys?.length) {
    recipe(clip);
    return;
  }
  const before = propsAt(clip, s);
  const old = keys.map((k) => ({ ...k, v: { ...k.v } }));
  // The recipe sees (and edits) the clip as it looks at s.
  writeProps(clip, before);
  recipe(clip);
  const after = readProps(clip);
  // Settings of removed effects leave the keyframes too.
  for (const k of keys) for (const p of Object.keys(k.v)) if (!(p in after)) delete k.v[p];
  const changed = Object.keys(after).filter((p) => p in before && Math.abs(after[p] - before[p]) > SAME);
  if (!changed.length) return;
  let key = keys[keyIndexAt(clip, s, tol)];
  if (!key) {
    key = { t: s, v: { ...before } };
    for (const p of Object.keys(key.v)) if (!(p in after)) delete key.v[p];
    insertKey(keys, key);
  }
  for (const p of changed) {
    for (const k of keys) if (k !== key && !(p in k.v)) k.v[p] = keyedValue(old, p, k.t) ?? before[p];
    key.v[p] = after[p];
  }
}

/** Source times of the clip's keyframes. */
export const keyTimes = (clip: Clip) => (clip.keyframes ?? []).map((k) => k.t);
