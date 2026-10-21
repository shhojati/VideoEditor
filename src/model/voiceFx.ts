// Voice effects: one voice change (pitch, robot, telephone…) and one space (echo, reverb) per clip,
// on Clip.audio. This file is the catalog (presets and their DSP recipes) plus the values over time;
// the processing lives in engine/audio/voiceDsp.ts and runs the same in preview and export. Pure.
import { keyedValue, srcTime } from './keyframes';
import type { Clip, SpaceFx, SpaceKind, VoiceFx, VoiceKind } from './types';

/** How a voice preset sounds. Frequencies in Hz, times in seconds. */
export interface VoiceRecipe {
  /** Default pitch (semitones). */
  pitch: number;
  /** Has a character beyond pitch, which the Intensity slider mixes in. */
  character: boolean;
  lowCut?: number;
  highCut?: number;
  /** Peaking EQ: centre, gain (dB), Q. */
  peak?: [freq: number, gain: number, q: number];
  /** High shelf: corner, gain (dB). */
  shelf?: [freq: number, gain: number];
  /** Saturation strength (tanh), 0 = clean. */
  drive?: number;
  /** Ring modulator: carrier frequency, wet share. */
  ring?: [freq: number, mix: number];
  /** Short feedback comb (metallic ring): delay, feedback. */
  comb?: [delay: number, feedback: number];
  /** Pitch wobble: LFO rate (Hz), depth (s of delay swing). */
  vibrato?: [rate: number, depth: number];
  /** Noise level added before the filters. */
  hiss?: number;
}

export const VOICE_PRESETS: Record<VoiceKind, VoiceRecipe> = {
  chipmunk: { pitch: 12, character: false },
  helium: { pitch: 7, character: false },
  child: { pitch: 4, character: true, shelf: [4000, 3] },
  deep: { pitch: -4, character: false },
  giant: { pitch: -8, character: false },
  monster: { pitch: -12, character: true, drive: 2.5, lowCut: 60 },
  robot: { pitch: 0, character: true, ring: [50, 0.8], comb: [0.006, 0.6] },
  alien: { pitch: 5, character: true, vibrato: [6, 0.002], ring: [30, 0.35] },
  underwater: { pitch: -1, character: true, highCut: 600, vibrato: [0.8, 0.004] },
  vibrato: { pitch: 0, character: true, vibrato: [5.5, 0.0015] },
  telephone: { pitch: 0, character: true, lowCut: 300, highCut: 3400, drive: 1.5 },
  radio: { pitch: 0, character: true, lowCut: 500, highCut: 4000, drive: 2, hiss: 0.004 },
  megaphone: { pitch: 0, character: true, lowCut: 600, highCut: 3000, peak: [1500, 8, 1.2], drive: 4 },
  walkie: { pitch: 0, character: true, lowCut: 700, highCut: 2500, drive: 6, hiss: 0.01 },
};

/** How a space preset sounds. */
export interface SpaceRecipe {
  mix: number;
  size: number;
  /** Feedback echo: feedback amount, loop low-pass (Hz). Its time follows Size. */
  echo?: [feedback: number, highCut: number];
  /** Fixed-time echo (s) under a reverb (caves). */
  early?: [delay: number, feedback: number];
  /** Freeverb damping, 0..1 (higher = darker). Room size follows Size. */
  reverb?: number;
}

export const SPACE_PRESETS: Record<SpaceKind, SpaceRecipe> = {
  echo: { mix: 0.4, size: 0.4, echo: [0.45, 3500] },
  cave: { mix: 0.45, size: 0.8, early: [0.13, 0.35], reverb: 0.7 },
  hall: { mix: 0.35, size: 0.75, reverb: 0.3 },
  room: { mix: 0.25, size: 0.35, reverb: 0.5 },
};

export const VOICE_KINDS = Object.keys(VOICE_PRESETS) as [VoiceKind, ...VoiceKind[]];
export const SPACE_KINDS = Object.keys(SPACE_PRESETS) as [SpaceKind, ...SpaceKind[]];

/** Inspector order and grouping. */
export const VOICE_GROUPS: VoiceKind[][] = [
  ['chipmunk', 'helium', 'child', 'deep', 'giant', 'monster'],
  ['robot', 'alien', 'underwater', 'vibrato'],
  ['telephone', 'radio', 'megaphone', 'walkie'],
];

export const PITCH_RANGE = { min: -12, max: 12 } as const;
/** How long echoes and reverbs keep ringing after the clip (s); the last half second fades out. */
export const SPACE_TAIL = 3;
const TAIL_FADE = 0.5;

export const createVoice = (kind: VoiceKind): VoiceFx => ({ kind, pitch: VOICE_PRESETS[kind].pitch, amount: 1 });
export const createSpace = (kind: SpaceKind): SpaceFx => ({ kind, mix: SPACE_PRESETS[kind].mix, size: SPACE_PRESETS[kind].size });

/** Pick a voice preset (undefined = none). A new preset starts from its own pitch and keeps the intensity. */
export function setVoice(clip: Clip, kind: VoiceKind | undefined) {
  if (!kind) delete clip.audio.voice;
  else if (clip.audio.voice?.kind !== kind) clip.audio.voice = { ...createVoice(kind), amount: clip.audio.voice?.amount ?? 1 };
}

/** Pick a space preset (undefined = none); a new one starts from its own mix and size. */
export function setSpace(clip: Clip, kind: SpaceKind | undefined) {
  if (!kind) delete clip.audio.space;
  else if (clip.audio.space?.kind !== kind) clip.audio.space = createSpace(kind);
}

export function setKeepPitch(clip: Clip, on: boolean) {
  if (on) clip.audio.keepPitch = true;
  else delete clip.audio.keepPitch;
}

/** The clip needs the voice stage: a voice preset, or speed that must keep its pitch. */
export const hasVoiceStage = (clip: Clip) => !!clip.audio.voice || (!!clip.audio.keepPitch && clip.speed !== 1);

export interface VoiceParams {
  /** Pitch-shift ratio (1 = unchanged), speed compensation included. */
  ratio: number;
  amount: number;
}

function keyed(clip: Clip, prop: string, t: number, fallback: number) {
  const keys = clip.keyframes;
  return (keys?.length ? keyedValue(keys, prop, srcTime(clip, t)) : undefined) ?? fallback;
}

/** Voice settings at timeline time t, keyframes applied. */
export function voiceParamsAt(clip: Clip, t: number): VoiceParams {
  const v = clip.audio.voice;
  const pitch = v ? keyed(clip, 'voice.pitch', t, v.pitch) : 0;
  const speed = clip.audio.keepPitch ? clip.speed : 1;
  return { ratio: 2 ** (pitch / 12) / speed, amount: v ? keyed(clip, 'voice.amount', t, v.amount) : 0 };
}

/** Space wet level at timeline time t (keyframes applied), faded out at the end of the tail after `end`. */
export function spaceMixAt(clip: Clip, t: number, end: number) {
  const s = clip.audio.space;
  if (!s) return 0;
  const fade = Math.max(0, Math.min(1, (end + SPACE_TAIL - t) / TAIL_FADE));
  return keyed(clip, 'space.mix', Math.min(t, end), s.mix) * fade;
}
