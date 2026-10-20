// Whisper segments -> subtitle cues: tidy text, break up long segments, flag doubtful ones.
import { RULES } from '../../model/subtitles';

export interface Segment {
  start: number;
  end: number;
  text: string;
}

export interface DraftCue extends Segment {
  review: boolean;
}

/**
 * Collapse runs of the same word or short phrase repeated more than `max` times (a typical Whisper
 * failure: "از از از از ..."). Returns the text and whether anything was removed.
 */
export function collapseRepeats(text: string, max = 3): { text: string; collapsed: boolean } {
  const words = text.split(/\s+/).filter(Boolean);
  let collapsed = false;
  for (let n = 1; n <= 4; n++) {
    for (let i = 0; i + n <= words.length; i++) {
      const unit = words.slice(i, i + n).join(' ');
      let reps = 1;
      while (words.slice(i + reps * n, i + (reps + 1) * n).join(' ') === unit) reps++;
      if (reps > max) {
        words.splice(i + max * n, (reps - max) * n);
        collapsed = true;
      }
    }
  }
  return { text: words.join(' '), collapsed };
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

const maxCueChars = RULES.maxCharsPerLine * RULES.maxLines;

export function segmentsToCues(segments: Segment[]): DraftCue[] {
  const cues: DraftCue[] = [];
  for (const seg of segments) {
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
      const cps = part.replace(/\s/g, '').length / Math.max(0.01, end - t);
      cues.push({
        start: t,
        end,
        text: part,
        review: collapsed || end - t < 0.5 || part.replace(/\s/g, '').length < 3 || cps > RULES.maxCps * 1.25,
      });
      t = end;
    }
  }
  // Whisper windows can overlap by a few ms at boundaries; keep cues ordered and disjoint.
  cues.sort((a, b) => a.start - b.start);
  for (let i = 1; i < cues.length; i++) if (cues[i].start < cues[i - 1].end) cues[i - 1].end = cues[i].start;
  return cues.filter((c) => c.end - c.start > 0.05);
}
