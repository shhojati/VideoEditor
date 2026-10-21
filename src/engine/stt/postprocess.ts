// Whisper segments -> subtitle cues: tidy text, break up long segments, flag doubtful ones.
import { RULES } from '../../model/subtitles';

export interface Word {
  text: string;
  start: number;
  end: number;
}

export interface Segment {
  start: number;
  end: number;
  text: string;
  /** Word timings, when the model gives them ("_timestamped" Whisper exports). */
  words?: Word[];
}

export interface DraftCue extends Segment {
  review: boolean;
}

/**
 * Collapse runs of the same word or short phrase repeated more than `max` times (a typical Whisper
 * failure: "از از از از ..."). Returns the text and whether anything was removed.
 */
export function collapseRepeats(text: string, max = 3): { text: string; collapsed: boolean } {
  const { items, collapsed } = collapseRepeatItems(text.split(/\s+/).filter(Boolean), (w) => w, max);
  return { text: items.join(' '), collapsed };
}

/** collapseRepeats over any list of words, compared by `key`. */
export function collapseRepeatItems<T>(list: readonly T[], key: (item: T) => string, max = 3) {
  const items = [...list];
  const unitOf = (from: number, n: number) => items.slice(from, from + n).map(key).join(' ');
  let collapsed = false;
  for (let n = 1; n <= 4; n++) {
    for (let i = 0; i + n <= items.length; i++) {
      const unit = unitOf(i, n);
      let reps = 1;
      while (i + (reps + 1) * n <= items.length && unitOf(i + reps * n, n) === unit) reps++;
      if (reps > max) {
        items.splice(i + max * n, (reps - max) * n);
        collapsed = true;
      }
    }
  }
  return { items, collapsed };
}

/** Split text into pieces of at most `maxChars`, at word boundaries, as evenly as possible. */
function splitText(text: string, pieces: number): string[] {
  const words = text.split(' ');
  if (pieces <= 1 || words.length < 2) return [text];
  const target = text.length / pieces;
  const out: string[] = [];
  let cur: string[] = [];
  for (const w of words) {
    cur.push(w);
    if (out.length < pieces - 1 && cur.join(' ').length >= target) {
      out.push(cur.join(' '));
      cur = [];
    }
  }
  if (cur.length) out.push(cur.join(' '));
  return out;
}

/** Split words into `pieces` runs of similar text length (at word boundaries). */
function splitWords(words: Word[], pieces: number): Word[][] {
  if (pieces <= 1 || words.length < 2) return [words];
  const target = words.reduce((n, w) => n + w.text.length + 1, 0) / pieces;
  const out: Word[][] = [];
  let cur: Word[] = [];
  let len = 0;
  for (const w of words) {
    cur.push(w);
    len += w.text.length + 1;
    if (out.length < pieces - 1 && len >= target) {
      out.push(cur);
      cur = [];
      len = 0;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

const maxCueChars = RULES.maxCharsPerLine * RULES.maxLines;
/** A pause at least this long between words starts a new cue. */
const PAUSE = 0.8;
const SENTENCE_END = /[.!?؟…]$/;

const charCount = (s: string) => s.replace(/\s/g, '').length;

function isDoubtful(text: string, start: number, end: number, collapsed: boolean) {
  const chars = charCount(text);
  return collapsed || end - start < 0.5 || chars < 3 || chars / Math.max(0.01, end - start) > RULES.maxCps * 1.25;
}

/** Cues from word timings: break at pauses and sentence ends, then by length and duration. */
function wordsToCues(segWords: Word[]): DraftCue[] {
  const { items: words, collapsed } = collapseRepeatItems(
    segWords.filter((w) => w.text.trim()),
    (w) => w.text,
  );
  const groups: Word[][] = [];
  let cur: Word[] = [];
  for (const w of words) {
    const prev = cur.at(-1);
    if (prev && (w.start - prev.end >= PAUSE || SENTENCE_END.test(prev.text))) {
      groups.push(cur);
      cur = [];
    }
    cur.push(w);
  }
  if (cur.length) groups.push(cur);
  const cues: DraftCue[] = [];
  for (const group of groups) {
    const text = group.map((w) => w.text).join(' ');
    const duration = group.at(-1)!.end - group[0].start;
    const pieces = Math.max(Math.ceil(text.length / maxCueChars), Math.ceil(duration / RULES.maxDuration));
    for (const part of splitWords(group, pieces)) {
      const start = part[0].start;
      const end = Math.max(part.at(-1)!.end, start + 0.1);
      const partText = part.map((w) => w.text).join(' ');
      cues.push({ start, end, text: partText, words: part, review: isDoubtful(partText, start, end, collapsed) });
    }
  }
  return cues;
}

export function segmentsToCues(segments: Segment[]): DraftCue[] {
  const cues: DraftCue[] = [];
  for (const seg of segments) {
    if (seg.words?.length) {
      cues.push(...wordsToCues(seg.words));
      continue;
    }
    const { text, collapsed } = collapseRepeats(seg.text.replace(/\s+/g, ' ').trim());
    if (!text || !(seg.end > seg.start)) continue;
    const duration = seg.end - seg.start;
    const pieces = Math.max(Math.ceil(text.length / maxCueChars), Math.ceil(duration / RULES.maxDuration));
    const parts = splitText(text, pieces);
    // Time is shared out in proportion to each part's length (no word timings available).
    let t = seg.start;
    for (const part of parts) {
      const d = (duration * part.length) / text.replace(/ /g, '').length || duration / parts.length;
      const end = part === parts.at(-1) ? seg.end : Math.min(seg.end, t + d);
      cues.push({ start: t, end, text: part, review: isDoubtful(part, t, end, collapsed) });
      t = end;
    }
  }
  // Whisper windows can overlap by a few ms at boundaries; keep cues ordered and disjoint.
  cues.sort((a, b) => a.start - b.start);
  for (let i = 1; i < cues.length; i++) if (cues[i].start < cues[i - 1].end) cues[i - 1].end = cues[i].start;
  return cues.filter((c) => c.end - c.start > 0.05);
}
