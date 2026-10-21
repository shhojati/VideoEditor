// Cutting a stretch of time out of the whole timeline (text-based editing): every unlocked track
// loses [from, to) and everything after it moves up, so picture, sound, subtitles and markers stay
// in sync. Like timeline.ts, these mutate the project inside edit().
import { newId } from './factories';
import { retime } from './remap';
import { cloneClip } from './timeline';
import type { Clip, Project } from './types';

const EPS = 1e-6;

/** The part of a clip between timeline times a < b, keeping every frame where it was. */
function part(clip: Clip, a: number, b: number, keepId: boolean): Clip {
  const out: Clip = keepId ? clip : { ...cloneClip(clip), id: newId() };
  Object.assign(out, retime(clip, a, b));
  if (a > clip.start + EPS) out.audio.fadeIn = 0;
  if (b < clip.start + clip.duration - EPS) out.audio.fadeOut = 0;
  return out;
}

/**
 * Remove [from, to) from every unlocked track and close the gap: clips inside go, clips across an
 * edge are trimmed (or split, when they cover the whole range), later clips move earlier. Subtitle
 * cues and markers follow the same way. Locked tracks are left alone. Returns the length removed.
 */
export function rippleDeleteRange(p: Project, from: number, to: number): number {
  const len = to - from;
  if (!(len > EPS)) return 0;
  for (const track of p.tracks) {
    if (track.locked) continue;
    const next: Clip[] = [];
    for (const clip of track.clips) {
      const start = clip.start;
      const end = start + clip.duration;
      if (end <= from + EPS) next.push(clip);
      else if (start >= to - EPS) {
        clip.start -= len;
        next.push(clip);
      } else if (start >= from - EPS && end <= to + EPS) {
        // Inside the cut: gone.
      } else if (start < from && end > to) {
        // Across the whole cut: the part before stays, the part after moves up to meet it.
        const right = part(clip, to, end, false);
        right.start = from;
        next.push(part(clip, start, from, true), right);
        for (const t of track.transitions ?? []) if (t.fromClipId === clip.id) t.fromClipId = right.id;
      } else if (start < from) next.push(part(clip, start, from, true));
      else {
        const right = part(clip, to, end, true);
        right.start = from;
        next.push(right);
      }
    }
    track.clips = next.sort((a, b) => a.start - b.start);
  }
  // Subtitles: cues inside go, cues across an edge are shortened, later ones move up.
  for (const st of p.subtitleTracks) {
    st.cues = st.cues.flatMap((c) => {
      const map = (t: number) => (t <= from ? t : t >= to ? t - len : from);
      const start = map(c.start);
      const end = map(c.end);
      if (end - start < 0.05) return [];
      const words = c.words?.filter((w) => w.end <= from || w.start >= to).map((w) => ({ ...w, start: map(w.start), end: map(w.end) }));
      return [{ ...c, start, end, ...(words && { words }) }];
    });
  }
  if (p.markers) p.markers = p.markers.filter((m) => m.t < from || m.t >= to).map((m) => (m.t >= to ? { ...m, t: m.t - len } : m));
  return len;
}

/** Several ranges at once (e.g. all silences), from the last to the first so earlier ones stay valid. */
export function rippleDeleteRanges(p: Project, ranges: readonly [number, number][]): number {
  // Overlapping or touching ranges become one, so nothing is cut twice.
  const merged: [number, number][] = [];
  for (const [a, b] of [...ranges].sort((x, y) => x[0] - y[0])) {
    const last = merged.at(-1);
    if (last && a <= last[1] + EPS) last[1] = Math.max(last[1], b);
    else merged.push([a, b]);
  }
  let total = 0;
  for (const [a, b] of merged.reverse()) total += rippleDeleteRange(p, a, b);
  return total;
}
