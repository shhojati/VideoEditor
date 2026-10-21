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
import { autoFixTiming } from '../../model/subtitles';
import { findClip } from '../../model/timeline';
import type { Project } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
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
}

export const useStt = create<SttState>()(() => ({ stage: 'idle', progress: 0, models: {} }));

/** Which models are installed for this browser's device (HEAD requests to our own server). */
export async function checkModels() {
  const device = preferredDevice();
  const entries = await Promise.all(
    WHISPER_SIZES.map(async (size) => {
      const ok = await Promise.all(
        requiredFiles(size, device).map((f) =>
          fetch(f, { method: 'HEAD' })
            .then((r) => r.ok && !(r.headers.get('content-type') ?? '').includes('text/html'))
            .catch(() => false),
        ),
      );
      return [size, ok.every(Boolean)] as const;
    }),
  );
  useStt.setState({ models: Object.fromEntries(entries), device });
}

let worker: Worker | null = null;

export function cancelAutoSubtitles() {
  worker?.terminate();
  worker = null;
  useStt.setState({ stage: 'idle', progress: 0, loading: undefined });
}

function mixItems(project: Project, selectedOnly: boolean): MixItem[] {
  const selected = new Set(useTimelineUi.getState().selection);
  const items: MixItem[] = [];
  for (const track of project.tracks) {
    if (track.muted || track.kind === 'text') continue;
    for (const clip of track.clips) {
      if (selectedOnly && !selected.has(clip.id)) continue;
      const asset = clip.assetId ? project.assets[clip.assetId] : undefined;
      if (!asset?.fileRef.opfsPath || peakVolume(clip) <= 0) continue;
      if (!(asset.kind === 'audio' || (asset.kind === 'video' && asset.hasAudio))) continue;
      items.push({
        opfsPath: asset.fileRef.opfsPath,
        start: clip.start,
        duration: clip.duration,
        inPoint: clip.inPoint,
        speed: clip.speed,
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
  const items = mixItems(project, opts.selectedOnly && useTimelineUi.getState().selection.some((id) => findClip(project, id)));
  if (!items.length) {
    useStt.setState({ stage: 'error', error: 'noAudio' });
    return;
  }
  useStt.setState({ stage: 'extracting', progress: 0, error: undefined, detail: undefined, created: undefined, rtf: undefined });
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
  await transcribe({ pcm, windows, model: opts.model, language: opts.language, device: preferredDevice() }, true);
}

function transcribe(req: SttRequest, allowFallback: boolean): Promise<void> {
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
          finish(segments, req.language);
          resolve();
          break;
        case 'error': {
          w.terminate();
          worker = null;
          const missing = /not found|404|Could not locate file|Unauthorized access/i.test(data.message);
          if (req.device === 'webgpu' && allowFallback && !missing) {
            // Some GPUs/drivers fail in WebGPU; the WASM backend is slower but works everywhere.
            void transcribe({ ...req, device: 'wasm' }, false).then(resolve);
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
  }));
  // Whisper segments touch each other; leave the minimum gap and sane durations from the start.
  autoFixTiming(track);
  useProjectStore.getState().edit('ops.autoSubtitles', (p) => void p.subtitleTracks.push(track));
  useSubtitlesUi.setState({ activeTrackId: track.id, tab: 'subtitles' });
  useStt.setState({ stage: 'done', created: track.cues.length, progress: 1 });
}
