// Subtitle cue operations and quality rules (plan §6). Like timeline.ts these mutate the project and
// are meant to run inside edit(). Invariant: cues on a track are sorted and never overlap.
import { newId } from './factories';
import type { Cue, CueWord, ID, Project, SubtitleTrack } from './types';

export const RULES = {
  minDuration: 1,
  maxDuration: 7,
  maxCharsPerLine: 42,
  maxLines: 2,
  minGap: 0.08,
  /** Characters per second above which a cue is hard to read. */
  maxCps: 20,
} as const;

/** Shortest cue the editor itself will create by splitting or trimming (s). */
export const MIN_CUE = 0.2;
const EPS = 1e-6;

export interface CueRef {
  track: SubtitleTrack;
  cue: Cue;
  index: number;
}

export function findCue(p: Project, cueId: ID): CueRef | undefined {
  for (const track of p.subtitleTracks) {
    const index = track.cues.findIndex((c) => c.id === cueId);
    if (index >= 0) return { track, cue: track.cues[index], index };
  }
  return undefined;
}

export const cueAt = (track: SubtitleTrack, t: number) => track.cues.find((c) => t >= c.start && t < c.end);

const sortCues = (track: SubtitleTrack) => track.cues.sort((a, b) => a.start - b.start);

/**
 * Add a cue at `time`. If `time` is inside a cue it starts at that cue's end; the cue is shortened
 * to fit before the next one. Returns null when there is no room.
 */
export function addCue(track: SubtitleTrack, time: number, text = '', duration = 2): ID | null {
  let start = Math.max(0, time);
  const inside = cueAt(track, start);
  if (inside) start = inside.end;
  const next = track.cues.find((c) => c.start >= start - EPS);
  const end = Math.min(start + duration, next ? next.start : Infinity);
  if (end - start < MIN_CUE) return null;
  const cue: Cue = { id: newId(), start, end, text };
  track.cues.push(cue);
  sortCues(track);
  return cue.id;
}

export function deleteCues(p: Project, ids: ReadonlySet<ID>) {
  for (const track of p.subtitleTracks) track.cues = track.cues.filter((c) => !ids.has(c.id));
}

const textWords = (text: string) => text.split(/\s+/).filter(Boolean);

/**
 * Timing of each word of a cue, in timeline seconds and inside the cue. Uses the speech-to-text
 * timings while they still match the text word for word (a typo fix keeps them); otherwise time
 * is shared out in proportion to word length.
 */
export function cueWords(cue: Cue): CueWord[] {
  const words = textWords(cue.text);
  const clampT = (t: number) => Math.min(cue.end, Math.max(cue.start, t));
  if (cue.words?.length === words.length) {
    return words.map((text, i) => ({ text, start: clampT(cue.words![i].start), end: clampT(cue.words![i].end) }));
  }
  const weights = words.map((w) => w.length + 1);
  const total = weights.reduce((a, b) => a + b, 0);
  let t = cue.start;
  return words.map((text, i) => {
    const start = t;
    t += ((cue.end - cue.start) * weights[i]) / total;
    return { text, start, end: i === words.length - 1 ? cue.end : t };
  });
}

/**
 * Split at `time`. With word timings the words spoken before `time` go left; otherwise words are
 * divided in proportion to the time on each side. Returns the new id.
 */
export function splitCue(p: Project, cueId: ID, time: number): ID | null {
  const ref = findCue(p, cueId);
  if (!ref) return null;
  const { cue, track } = ref;
  if (time - cue.start < MIN_CUE || cue.end - time < MIN_CUE) return null;
  const words = textWords(cue.text);
  const timed = cue.words ? cueWords(cue) : undefined;
  const ratio = (time - cue.start) / (cue.end - cue.start);
  const wanted = timed ? timed.filter((w) => (w.start + w.end) / 2 < time).length : Math.round(words.length * ratio);
  const cut = words.length < 2 ? words.length : Math.min(words.length - 1, Math.max(1, wanted));
  const right: Cue = { id: newId(), start: time, end: cue.end, text: words.slice(cut).join(' ') };
  if (timed) {
    right.words = timed.slice(cut);
    cue.words = timed.slice(0, cut);
  }
  cue.end = time;
  cue.text = words.slice(0, cut).join(' ');
  track.cues.splice(ref.index + 1, 0, right);
  return right.id;
}

/** Merge a cue with the one after it. */
export function mergeWithNext(p: Project, cueId: ID): boolean {
  const ref = findCue(p, cueId);
  const next = ref?.track.cues[ref.index + 1];
  if (!ref || !next) return false;
  if (ref.cue.words || next.words) ref.cue.words = [...cueWords(ref.cue), ...cueWords(next)];
  ref.cue.end = next.end;
  ref.cue.text = [ref.cue.text, next.text].filter(Boolean).join(' ');
  delete ref.cue.flag;
  ref.track.cues.splice(ref.index + 1, 1);
  return true;
}

export interface Range {
  min: number;
  max: number;
}

/** Where a cue edge can go without overlapping its neighbours or getting shorter than MIN_CUE. */
export function cueEdgeLimits(track: SubtitleTrack, index: number, edge: 'start' | 'end'): Range {
  const cue = track.cues[index];
  if (edge === 'start') return { min: index > 0 ? track.cues[index - 1].end : 0, max: cue.end - MIN_CUE };
  return { min: cue.start + MIN_CUE, max: index < track.cues.length - 1 ? track.cues[index + 1].start : Infinity };
}

const clamp = (v: number, r: Range) => Math.min(r.max, Math.max(r.min, v));

/** Set one edge (clamped). Returns the applied time. */
export function setCueEdge(p: Project, cueId: ID, edge: 'start' | 'end', time: number): number {
  const ref = findCue(p, cueId);
  if (!ref) return NaN;
  const t = clamp(time, cueEdgeLimits(ref.track, ref.index, edge));
  ref.cue[edge] = t;
  return t;
}

/** Can these cues move by `delta` without overlapping the cues that stay put? */
export function canShiftCues(track: SubtitleTrack, ids: ReadonlySet<ID>, delta: number): boolean {
  const moving = track.cues.filter((c) => ids.has(c.id));
  const fixed = track.cues.filter((c) => !ids.has(c.id));
  return moving.every(
    (m) => m.start + delta >= -EPS && fixed.every((f) => m.end + delta <= f.start + EPS || m.start + delta >= f.end - EPS),
  );
}

export function shiftCues(p: Project, ids: ReadonlySet<ID>, delta: number): boolean {
  const tracks = p.subtitleTracks.filter((t) => t.cues.some((c) => ids.has(c.id)));
  if (!tracks.every((t) => canShiftCues(t, ids, delta))) return false;
  for (const t of tracks) {
    for (const c of t.cues) {
      if (!ids.has(c.id)) continue;
      c.start = Math.max(0, c.start + delta);
      c.end = c.end + delta;
      for (const w of c.words ?? []) {
        w.start = Math.max(0, w.start + delta);
        w.end = Math.max(0, w.end + delta);
      }
    }
    sortCues(t);
  }
  return true;
}

export function setCueText(p: Project, cueId: ID, text: string) {
  const ref = findCue(p, cueId);
  if (!ref) return;
  // Same number of words: a correction, the timings still hold. Otherwise they are estimated.
  if (ref.cue.words && ref.cue.words.length !== textWords(text).length) delete ref.cue.words;
  ref.cue.text = text;
  delete ref.cue.flag; // a human looked at it
}

// ---- quality checks ----------------------------------------------------------------------------

export type CueIssue = 'overlap' | 'short' | 'long' | 'lineLength' | 'lines' | 'cps' | 'gap' | 'empty' | 'review';

const visibleLength = (s: string) => s.replace(/[\s‌]/g, '').length;

/** Problems with each cue, keyed by cue id (cues without problems are absent). */
export function lintCues(cues: readonly Cue[]): Map<ID, CueIssue[]> {
  const out = new Map<ID, CueIssue[]>();
  cues.forEach((c, i) => {
    const issues: CueIssue[] = [];
    const d = c.end - c.start;
    const lines = c.text.split('\n');
    if (!c.text.trim()) issues.push('empty');
    if (d < RULES.minDuration - EPS) issues.push('short');
    if (d > RULES.maxDuration + EPS) issues.push('long');
    if (lines.length > RULES.maxLines) issues.push('lines');
    // A single long line still fits if the renderer can wrap it into two.
    const longest = Math.max(...lines.map((l) => l.length));
    if (lines.length > 1 ? longest > RULES.maxCharsPerLine : longest > RULES.maxCharsPerLine * RULES.maxLines) {
      issues.push('lineLength');
    }
    if (d > 0 && visibleLength(c.text) / d > RULES.maxCps) issues.push('cps');
    const next = cues[i + 1];
    if (next && next.start < c.end - EPS) issues.push('overlap');
    else if (next && next.start - c.end < RULES.minGap - EPS) issues.push('gap');
    if (c.flag === 'review') issues.push('review');
    if (issues.length) out.set(c.id, issues);
  });
  return out;
}

/**
 * Make timing conform where it can without touching the text: resolve overlaps, keep the minimum
 * gap, cap long cues, and extend short cues into free space. Returns how many cues changed.
 */
export function autoFixTiming(track: SubtitleTrack): number {
  sortCues(track);
  let changed = 0;
  track.cues.forEach((c, i) => {
    const before = `${c.start}/${c.end}`;
    const next = track.cues[i + 1];
    const limit = next ? next.start - RULES.minGap : Infinity;
    if (c.end - c.start > RULES.maxDuration) c.end = c.start + RULES.maxDuration;
    if (c.end - c.start < RULES.minDuration) c.end = Math.min(c.start + RULES.minDuration, Math.max(c.end, limit));
    if (c.end > limit) c.end = Math.max(c.start + MIN_CUE, limit);
    if (next && next.start < c.end) next.start = c.end; // still overlapping: push the next one
    if (next && next.end - next.start < MIN_CUE) next.end = next.start + MIN_CUE;
    if (`${c.start}/${c.end}` !== before) changed++;
  });
  return changed;
}

// ---- digits ------------------------------------------------------------------------------------

const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';

export function convertDigits(text: string, mode: 'keep' | 'persian' | 'latin' = 'keep'): string {
  if (mode === 'persian') return text.replace(/[0-9٠-٩]/g, (d) => FA[AR.includes(d) ? AR.indexOf(d) : Number(d)]);
  if (mode === 'latin') return text.replace(/[۰-۹٠-٩]/g, (d) => String(FA.includes(d) ? FA.indexOf(d) : AR.indexOf(d)));
  return text;
}
