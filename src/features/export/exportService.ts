import { create } from 'zustand';
import { FORMATS, outputMime, outputName, type ExportSettings } from '../../engine/export/settings';
import type { Project } from '../../model/types';
import type { ExportMessage, ExportRequest } from '../../workers/export.worker';
import { projectDuckPlan } from '../media-bin/speechActivity';
import { exportSubtitleFile } from '../subtitles/subtitleActions';
import type { WatermarkSpec } from '../../engine/render/watermark';
import { loadWatermark, watermarkImageUrl } from '../../lib/appConfig';
import type { ExportPolicy } from '../account/policy';

export type ExportStage = 'idle' | 'audio' | 'video' | 'encode' | 'done' | 'cancelled' | 'error';

interface ExportState {
  open: boolean;
  stage: ExportStage;
  progress: number;
  startedAt?: number;
  /** Seconds left, estimated from video progress so far. */
  eta?: number;
  result?: {
    url?: string;
    name: string;
    bytes: number;
    seconds: number;
    savedToDisk: boolean;
    audioCodec: string | null;
    aacSource: 'native' | 'wasm' | null;
    settings: ExportSettings;
  };
  error?: string;
}

export const useExport = create<ExportState>()(() => ({ open: false, stage: 'idle', progress: 0 }));

let worker: Worker | null = null;
let fileHandle: FileSystemFileHandle | null = null;

type SavePicker = (o: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;

export const safeFileName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'video';

/** The owner's watermark (public/config/watermark.json), with its image decoded if it has one. */
async function freeWatermark(): Promise<WatermarkSpec> {
  const config = await loadWatermark();
  const url = watermarkImageUrl(config);
  if (!url) return { config };
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(String(r.status));
    return { config, image: await createImageBitmap(await r.blob()) };
  } catch {
    return { config }; // image missing: fall back to the text
  }
}

/**
 * Must be called from the click handler: the save picker needs the user gesture, so it is asked
 * for before any other awaiting. Without File System Access the result is kept in memory and
 * offered as a download. `policy` comes from exportPolicy (features/account/policy.ts).
 */
export async function startExport(project: Project, settings: ExportSettings, policy: ExportPolicy) {
  if (policy.kind !== 'ok') return;
  const name = outputName(safeFileName(project.name), settings);
  const ext = name.slice(name.lastIndexOf('.'));
  fileHandle = null;
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    try {
      fileHandle = await picker({
        suggestedName: name,
        types: [{ description: ext.slice(1).toUpperCase(), accept: { [outputMime(settings)]: [ext] } }],
      });
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return; // user closed the picker
      fileHandle = null; // picker unavailable here (e.g. automation): fall back to download
    }
  }
  const watermark = policy.watermark ? await freeWatermark() : undefined;
  cleanupResult();
  const startedAt = performance.now();
  useExport.setState({ stage: 'audio', progress: 0, startedAt, eta: undefined, error: undefined });
  const w = new Worker(new URL('../../workers/export.worker.ts', import.meta.url), { type: 'module' });
  worker = w;
  w.onmessage = ({ data }: MessageEvent<ExportMessage>) => {
    if (worker !== w) return;
    if (data.type === 'progress') {
      const progress = data.done / data.total;
      const elapsed = (performance.now() - startedAt) / 1000;
      useExport.setState({
        stage: data.phase,
        progress,
        eta: data.phase === 'video' && progress > 0.02 ? (elapsed / progress) * (1 - progress) : undefined,
      });
      return;
    }
    w.terminate();
    worker = null;
    if (data.type === 'done') {
      useExport.setState({
        stage: 'done',
        progress: 1,
        result: {
          url: data.blob ? URL.createObjectURL(data.blob) : undefined,
          name: fileHandle?.name ?? name,
          bytes: data.bytes,
          seconds: data.ms / 1000,
          savedToDisk: !data.blob,
          audioCodec: data.audioCodec,
          aacSource: data.aacSource,
          settings,
        },
      });
      if (settings.srt && FORMATS[settings.format].kind === 'video')
        for (const st of project.subtitleTracks)
          if (!st.hidden && st.cues.length) exportSubtitleFile(project, st, 'srt');
    } else if (data.type === 'cancelled') {
      void removePartialFile();
      useExport.setState({ stage: 'cancelled' });
    } else {
      void removePartialFile();
      useExport.setState({ stage: 'error', error: data.message });
    }
  };
  const duck = projectDuckPlan(project);
  w.postMessage({ type: 'start', project, settings, file: fileHandle ?? undefined, watermark, duck } satisfies ExportRequest);
}

export function cancelExport() {
  worker?.postMessage({ type: 'cancel' } satisfies ExportRequest);
}

async function removePartialFile() {
  try {
    await (fileHandle as unknown as { remove?: () => Promise<void> })?.remove?.();
  } catch {
    // leave it; the user can delete it
  }
}

function cleanupResult() {
  const url = useExport.getState().result?.url;
  if (url) URL.revokeObjectURL(url);
  useExport.setState({ result: undefined });
}

export function closeExportDialog() {
  if (worker) return; // keep it open while exporting
  cleanupResult();
  useExport.setState({ open: false, stage: 'idle', progress: 0 });
}
