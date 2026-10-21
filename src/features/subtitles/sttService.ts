// Runs automatic subtitles in the background: mix the timeline (or selected clips) to 16 kHz mono in
// the media worker, plan windows at quiet points, transcribe in the STT worker, then add the result
// as a new subtitle track in one undo step. The user can keep editing meanwhile.
import { create } from 'zustand';
import { detectRtl } from '../../engine/render/textLayout';
import { STT_RATE } from '../../engine/stt/audio16k';
import { preferredDevice, requiredFiles, WHISPER_SIZES, type SttDevice, type WhisperSize } from '../../engine/stt/models';
import { segmentsToCues, type Segment } from '../../engine/stt/postprocess';
import { planWindows } from '../../engine/stt/windows';
import { createSubtitleTrack, newId } from '../../model/factories';
import { peakVolume } from '../../model/keyframes';
import { autoFixTiming, cueWords } from '../../model/subtitles';
import { mediaTimeAt } from '../../model/remap';
import { flattenForMedia } from '../../model/sequences';
import { findClip } from '../../model/timeline';
import type { ID, Project } from '../../model/types';
import { currentProject, useProjectStore } from '../../store/projectStore';
import type { SttMessage, SttRequest } from '../../workers/stt.worker';
import type { MixItem } from '../../workers/media.worker';
import { mediaWorker } from '../media-bin/mediaService';
import { useTimelineUi } from '../timeline/timelineUi';
import { RTL_LANGUAGES } from './subtitleActions';
import { useSubtitlesUi } from './subtitlesUi';

export type SttStage = 'idle' | 'extracting' | 'loading' | 'transcribing' | 'done' | 'error';

interface SttState {
  stage: SttStage;
  /** 0..1 of the audio transcribed. */
  progress: number;
  /** Model download/initialisation progress 0..100. */
  loading?: number;
  /** Real-time factor: processing seconds per audio second. */
  rtf?: number;
  device?: SttDevice;
  error?: 'noAudio' | 'missingModel' | 'failed';
  detail?: string;
  /** Cues created by the last run. */
  created?: number;
  models: Partial<Record<WhisperSize, boolean>>;
  /** Installed models that give word timings ("_timestamped"); others give segment times only. */
  wordModels: Partial<Record<WhisperSize, boolean>>;
  /** What the current run is for: a subtitle track, or transcripts for text-based editing. */
  target?: 'subtitles' | 'transcript';
}

export const useStt = create<SttState>()(() => ({ stage: 'idle', progress: 0, models: {}, wordModels: {} }));

/** Which models are installed for this browser's device (HEAD requests to our own server). */
export async function checkModels() {
  const device = preferredDevice();
  const installed = async (size: WhisperSize, words: boolean) => {
    const ok = await Promise.all(
      requiredFiles(size, device, words).map((f) =>
        fetch(f, { method: 'HEAD' })
          .then((r) => r.ok && !(r.headers.get('content-type') ?? '').includes('text/html'))
          .catch(() => false),
      ),
    );
    return ok.every(Boolean);
  };
  const entries = await Promise.all(
    WHISPER_SIZES.map(async (size) => {
      // Older installs only have the plain models: still usable, without word timings.
      const words = await installed(size, true);
      return [size, words || (await installed(size, false)), words] as const;
    }),
  );
  useStt.setState({
    models: Object.fromEntries(entries.map(([s, ok]) => [s, ok])),
    wordModels: Object.fromEntries(entries.map(([s, , words]) => [s, words])),
    device,
  });
}

let worker: Worker | null = null;

export function cancelAutoSubtitles() {
  worker?.terminate();
  worker = null;
  useStt.setState({ stage: 'idle', progress: 0, loading: undefined });
}

/** Audible clips to transcribe: all of them, or only those in `only`. */
function mixItems(project: Project, only?: ReadonlySet<ID>): MixItem[] {
  const items: MixItem[] = [];
  for (const track of project.tracks) {
    if (track.muted || track.kind === 'text') continue;
    for (const clip of track.clips) {
      if (only && !only.has(clip.id)) continue;
      const asset = clip.assetId ? project.assets[clip.assetId] : undefined;
      // Reversed speech cannot be transcribed; a freeze frame is silent.
      if (!asset?.fileRef.opfsPath || peakVolume(clip) <= 0 || asset.reverseOf || clip.freeze) continue;
      if (!(asset.kind === 'audio' || (asset.kind === 'video' && asset.hasAudio))) continue;
      items.push({
        opfsPath: asset.fileRef.opfsPath,
        start: clip.start,
        duration: clip.duration,
        inPoint: clip.inPoint,
        speed: clip.speed,
        speedCurve: clip.speedCurve,
        gain: peakVolume(clip),
      });
    }
  }
  return items;
}

export async function startAutoSubtitles(opts: { model: WhisperSize; language: string | null; selectedOnly: boolean }) {
  const project = useProjectStore.getState().history?.present;
  if (!project) return;
  cancelAutoSubtitles();
  const selection = useTimelineUi.getState().selection;
  const items = mixItems(flattenForMedia(project), opts.selectedOnly && selection.some((id) => findClip(project, id)) ? new Set(selection) : undefined);
  if (!items.length) {
    useStt.setState({ stage: 'error', error: 'noAudio' });
    return;
  }
  useStt.setState({ stage: 'extracting', progress: 0, error: undefined, detail: undefined, created: undefined, rtf: undefined, target: 'subtitles' });
  const duration = Math.max(...items.map((i) => i.start + i.duration));
  let pcm: Float32Array;
  try {
    ({ pcm } = await mediaWorker().mixdown16k({ items, duration }));
  } catch (e) {
    useStt.setState({ stage: 'error', error: 'failed', detail: String(e) });
    return;
  }
  const windows = planWindows(pcm, STT_RATE);
  if (!windows.length) {
    useStt.setState({ stage: 'error', error: 'noAudio' });
    return;
  }
  // Not checked yet (the panel was never opened): try the word model; a missing one is reported.
  const words = useStt.getState().wordModels[opts.model] ?? true;
  await transcribe({ pcm, windows, model: opts.model, language: opts.language, device: preferredDevice(), words }, true, (segments) =>
    finish(segments, opts.language),
  );
}

/**
 * Transcribe clips for text-based editing: each clip on its own, its words stored on it in source
 * time (`Clip.transcript`), so trims and splits keep them. Without word timings (older models)
 * the words are estimated from text length.
 */
export async function transcribeClips(clipIds: readonly ID[], opts: { model: WhisperSize; language: string | null }) {
  cancelAutoSubtitles();
  let done = 0;
  for (const clipId of clipIds) {
    const project = currentProject();
    const clip = project && findClip(project, clipId)?.clip;
    if (!project || !clip) continue;
    const items = mixItems(project, new Set([clipId]));
    if (!items.length) continue;
    useStt.setState({ stage: 'extracting', progress: 0, error: undefined, detail: undefined, created: undefined, rtf: undefined, target: 'transcript' });
    let pcm: Float32Array;
    try {
      ({ pcm } = await mediaWorker().mixdown16k({ items, duration: clip.start + clip.duration }));
    } catch (e) {
      useStt.setState({ stage: 'error', error: 'failed', detail: String(e) });
      return;
    }
    const windows = planWindows(pcm, STT_RATE);
    if (!windows.length) continue;
    const words = useStt.getState().wordModels[opts.model] ?? true;
    const segments = await new Promise<Segment[] | null>((resolve) =>
      void transcribe({ pcm, windows, model: opts.model, language: opts.language, device: preferredDevice(), words }, true, resolve).then(() => resolve(null)),
    );
    if (!segments) return; // failed or cancelled
    const cues = segmentsToCues(segments).map((d, i) => ({ id: String(i), start: d.start, end: d.end, text: d.text, ...(d.words?.length && { words: d.words }) }));
    const timed = cues.flatMap((c) => cueWords(c));
    const lang = opts.language ?? (cues.slice(0, 10).some((c) => detectRtl(c.text)) ? 'fa' : 'en');
    useProjectStore.getState().edit('ops.transcribe', (d) => {
      const c = findClip(d, clipId)?.clip;
      if (!c) return;
      const inside = timed.filter((w) => w.end > c.start && w.start < c.start + c.duration);
      c.transcript = { language: lang, rtl: RTL_LANGUAGES.includes(lang), words: inside.map((w) => ({ text: w.text, s: mediaTimeAt(c, w.start), e: mediaTimeAt(c, w.end) })) };
    });
    done++;
  }
  useStt.setState({ stage: 'done', created: done, progress: 1 });
}

function transcribe(req: SttRequest, allowFallback: boolean, onDone: (segments: Segment[]) => void): Promise<void> {
  return new Promise((resolve) => {
    const segments: Segment[] = [];
    const w = new Worker(new URL('../../workers/stt.worker.ts', import.meta.url), { type: 'module' });
    worker = w;
    useStt.setState({ stage: 'loading', device: req.device, loading: 0 });
    w.onmessage = ({ data }: MessageEvent<SttMessage>) => {
      if (worker !== w) return; // cancelled
      switch (data.type) {
        case 'loading':
          useStt.setState({ loading: data.progress });
          break;
        case 'segments':
          segments.push(...data.segments);
          break;
        case 'progress':
          useStt.setState({ stage: 'transcribing', progress: data.done / data.total, rtf: data.seconds / data.done });
          break;
        case 'done':
          w.terminate();
          worker = null;
          onDone(segments);
          resolve();
          break;
        case 'error': {
          w.terminate();
          worker = null;
          const missing = /not found|404|Could not locate file|Unauthorized access/i.test(data.message);
          if (req.device === 'webgpu' && allowFallback && !missing) {
            // Some GPUs/drivers fail in WebGPU; the WASM backend is slower but works everywhere.
            void transcribe({ ...req, device: 'wasm' }, false, onDone).then(resolve);
            return;
          }
          useStt.setState({ stage: 'error', error: missing ? 'missingModel' : 'failed', detail: data.message });
          resolve();
        }
      }
    };
    // Keep our copy: the worker may be restarted on the WASM fallback.
    w.postMessage({ ...req, pcm: req.pcm.slice() });
  });
}

function finish(segments: Segment[], language: string | null) {
  const drafts = segmentsToCues(segments);
  if (!drafts.length) {
    useStt.setState({ stage: 'done', created: 0, progress: 1 });
    return;
  }
  const lang = language ?? (drafts.slice(0, 10).some((c) => detectRtl(c.text)) ? 'fa' : 'en');
  const track = { ...createSubtitleTrack(lang), rtl: RTL_LANGUAGES.includes(lang) };
  track.cues = drafts.map((d) => ({
    id: newId(),
    start: d.start,
    end: d.end,
    text: d.text,
    ...(d.review ? { flag: 'review' as const } : {}),
    ...(d.words?.length ? { words: d.words } : {}),
  }));
  // Whisper segments touch each other; leave the minimum gap and sane durations from the start.
  autoFixTiming(track);
  useProjectStore.getState().edit('ops.autoSubtitles', (p) => void p.subtitleTracks.push(track));
  useSubtitlesUi.setState({ activeTrackId: track.id, tab: 'subtitles' });
  useStt.setState({ stage: 'done', created: track.cues.length, progress: 1 });
}
