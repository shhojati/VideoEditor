import { detectRtl } from '../../engine/render/textLayout';
import { formatSrt, formatVtt, parseSubtitles, subtitleBlob } from '../../lib/subtitles/formats';
import { createSubtitleTrack, newId } from '../../model/factories';
import { autoFixTiming, convertDigits } from '../../model/subtitles';
import type { ID, Project, SubtitleTrack } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { useSubtitlesUi } from './subtitlesUi';

const edit = (...args: Parameters<ReturnType<typeof useProjectStore.getState>['edit']>) =>
  useProjectStore.getState().edit(...args);

export const RTL_LANGUAGES = ['fa', 'ar', 'he', 'ur'];
export const SUBTITLE_LANGUAGES = ['fa', 'en', 'ar'] as const;

export function addSubtitleTrack(language: string): ID {
  const track = createSubtitleTrack(language);
  edit('ops.addSubtitleTrack', (p) => void p.subtitleTracks.push(track));
  useSubtitlesUi.setState({ activeTrackId: track.id });
  return track.id;
}

export function removeSubtitleTrack(id: ID) {
  edit('ops.removeSubtitleTrack', (p) => {
    p.subtitleTracks = p.subtitleTracks.filter((t) => t.id !== id);
  });
}

/** Import an SRT/VTT file as a new track. Language is guessed from the text direction. */
export async function importSubtitleFile(file: File): Promise<{ cues: number; skipped: number }> {
  const { cues, skipped } = parseSubtitles(file.name, await file.text());
  if (!cues.length) return { cues: 0, skipped };
  const rtl = cues.slice(0, 10).some((c) => detectRtl(c.text));
  const track: SubtitleTrack = { ...createSubtitleTrack(rtl ? 'fa' : 'en'), rtl };
  track.cues = cues.map((c) => ({ id: newId(), ...c }));
  // Imported files may overlap or have zero gaps; keep them as they are (lint shows it) but sorted.
  edit('ops.importSubtitles', (p) => void p.subtitleTracks.push(track));
  useSubtitlesUi.setState({ activeTrackId: track.id });
  return { cues: cues.length, skipped };
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Text as shown (digits style applied) for files that leave the app. */
export function exportCues(track: SubtitleTrack) {
  return track.cues.filter((c) => c.text.trim()).map((c) => ({ ...c, text: convertDigits(c.text, track.style.digits) }));
}

export function exportSubtitleFile(project: Project, track: SubtitleTrack, format: 'srt' | 'vtt') {
  const cues = exportCues(track);
  const text = format === 'srt' ? formatSrt(cues, { rtl: track.rtl }) : formatVtt(cues, { rtl: track.rtl });
  const safeName = project.name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'subtitles';
  download(subtitleBlob(text), `${safeName}.${track.language}.${format}`);
}

export function fixTiming(trackId: ID) {
  let changed = 0;
  edit('ops.fixTiming', (p) => {
    const t = p.subtitleTracks.find((x) => x.id === trackId);
    if (t) changed = autoFixTiming(t);
  });
  return changed;
}
