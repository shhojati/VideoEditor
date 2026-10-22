// Text-based editing: cut by words, and remove pauses and filler words (Pro).
import { rippleDeleteRanges } from '../../model/cut';
import { isFiller, silences, timelineWords, type TimelineWord } from '../../model/transcript';
import type { Clip, ID, Project } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { requireAi } from '../account/aiGate';

/** A pause longer than this after a cut word is kept (only a little of it goes). */
const LONG_PAUSE = 0.5;

export interface TranscriptClip {
  clip: Clip;
  words: TimelineWord[];
}

/** Clips with a transcript, in timeline order. */
export function transcriptClips(p: Project): TranscriptClip[] {
  return p.tracks
    .flatMap((t) => t.clips)
    .filter((c) => c.transcript?.words.length)
    .sort((a, b) => a.start - b.start)
    .map((clip) => ({ clip, words: timelineWords(clip) }));
}

/**
 * The time to cut for words first..last of a clip: from the first word's start to the next word
 * (the pause after them goes too), or a moment after the last one when that pause is long.
 */
export function wordsRange(tc: TranscriptClip, first: number, last: number): [number, number] {
  const next = tc.words[last + 1];
  const end = tc.words[last].end;
  const clipEnd = tc.clip.start + tc.clip.duration;
  const to = next && next.start - end < LONG_PAUSE ? next.start : Math.min(clipEnd, end + 0.1);
  return [tc.words[first].start, to];
}

export interface Removal {
  id: string;
  kind: 'silence' | 'filler';
  range: [number, number];
  /** The filler word. */
  text?: string;
}

/** Pauses of at least `minSilence` s and filler words, across every transcript. */
export function removals(p: Project, opts: { minSilence: number; fillers: boolean; optionalFillers: boolean }): Removal[] {
  const out: Removal[] = [];
  for (const tc of transcriptClips(p)) {
    silences(tc.clip, opts.minSilence).forEach((range, i) => out.push({ id: `${tc.clip.id}:s${i}`, kind: 'silence', range }));
    if (!opts.fillers) continue;
    tc.words.forEach((w, i) => {
      if (isFiller(w.text, tc.clip.transcript!.language, opts.optionalFillers)) out.push({ id: `${tc.clip.id}:f${i}`, kind: 'filler', text: w.text, range: wordsRange(tc, i, i) });
    });
  }
  return out.sort((a, b) => a.range[0] - b.range[0]);
}

/** Cut these ranges from every unlocked track and close the gaps (one undo step, Pro). */
export function cutRanges(ranges: readonly [number, number][], label = 'ops.cutText'): boolean {
  if (!ranges.length || !requireAi(() => cutRanges(ranges, label))) return false;
  useProjectStore.getState().edit(label, (d) => void rippleDeleteRanges(d, ranges));
  return true;
}

export const clipOf = (p: Project, id: ID) => p.tracks.flatMap((t) => t.clips).find((c) => c.id === id);
