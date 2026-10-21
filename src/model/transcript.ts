// Transcripts for text-based editing: a clip's words (source time, so trims and splits keep them),
// shown on the timeline; silences and filler words to remove.
import { sourceLength, timelineTimeAt } from './remap';
import type { Clip } from './types';

export interface TimelineWord {
  text: string;
  start: number;
  end: number;
}

/** The clip's transcript words that it actually plays, in timeline time. */
export function timelineWords(clip: Clip): TimelineWord[] {
  const t = clip.transcript;
  if (!t || clip.freeze) return [];
  const from = clip.inPoint;
  const to = clip.inPoint + sourceLength(clip);
  return t.words
    .filter((w) => w.e > from && w.s < to)
    .map((w) => ({ text: w.text, start: timelineTimeAt(clip, Math.max(from, w.s)), end: timelineTimeAt(clip, Math.min(to, w.e)) }));
}

/** Hesitation sounds, per language; "optional" ones are real words that are often fillers. */
export const FILLERS = {
  en: { always: ['um', 'umm', 'uh', 'uhh', 'er', 'erm', 'hmm', 'mm', 'ah'], optional: ['like', 'basically', 'actually'] },
  fa: { always: ['اِ', 'اِم', 'اِه', 'ام', 'امم', 'اوم', 'ممم', 'آ', 'اه'], optional: ['یعنی', 'خب', 'مثلاً'] },
} as const;

/** Lower case, without punctuation and Arabic diacritics other than kasra (which tells اِ from ا). */
const normalize = (text: string) =>
  text
    .toLowerCase()
    .replace(/[ً-ُّْ]/g, '')
    .replace(/[^\p{L}\p{M}]/gu, '');

export function isFiller(text: string, language: string, includeOptional: boolean): boolean {
  const lists = FILLERS[language as keyof typeof FILLERS] ?? FILLERS.en;
  const word = normalize(text);
  if (!word) return false;
  return (lists.always as readonly string[]).includes(word) || (includeOptional && (lists.optional as readonly string[]).includes(word));
}

/** Room kept on each side of speech when a silence is cut (s). */
export const SILENCE_PAD = 0.1;

/**
 * Pauses of at least `min` seconds in a clip (between its words, and before the first / after the
 * last), as ranges to cut, leaving SILENCE_PAD of quiet next to the words.
 */
export function silences(clip: Clip, min: number): [number, number][] {
  const words = timelineWords(clip);
  if (!words.length) return [];
  const out: [number, number][] = [];
  const edges = [clip.start, ...words.flatMap((w) => [w.start, w.end]), clip.start + clip.duration];
  for (let i = 0; i < edges.length; i += 2) {
    const gapStart = edges[i];
    const gapEnd = edges[i + 1];
    if (gapEnd - gapStart < min) continue;
    const a = i === 0 ? gapStart : gapStart + SILENCE_PAD;
    const b = i + 1 === edges.length - 1 ? gapEnd : gapEnd - SILENCE_PAD;
    if (b - a > 0.05) out.push([a, b]);
  }
  return out;
}
