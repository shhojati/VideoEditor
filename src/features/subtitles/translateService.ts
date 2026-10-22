// Translate a subtitle track English → Persian (Pro), into a new track with the same timing.
import { create } from 'zustand';
import { preferredDevice } from '../../engine/stt/models';
import { createSubtitleTrack, newId } from '../../model/factories';
import type { ID } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { TRANSLATE_DTYPE, TRANSLATE_MODEL, type TranslateMessage, type TranslateQuality, type TranslateRequest } from '../../workers/translate.worker';
import { requireAi } from '../account/aiGate';
import { useSubtitlesUi } from './subtitlesUi';

interface TranslateState {
  /** Track being translated. */
  trackId: ID | null;
  stage: 'idle' | 'loading' | 'translating' | 'done' | 'error';
  progress: number;
  loading?: number;
  error?: 'missingModel' | 'failed';
  detail?: string;
  installed: Partial<Record<TranslateQuality, boolean>>;
}

export const useTranslate = create<TranslateState>()(() => ({ trackId: null, stage: 'idle', progress: 0, installed: {} }));

const FILES = (q: TranslateQuality) => {
  const suffix = TRANSLATE_DTYPE[q] === 'q8' ? 'quantized' : 'fp16';
  return ['tokenizer.json', 'config.json', `onnx/encoder_model_${suffix}.onnx`, `onnx/decoder_model_merged_${suffix}.onnx`].map((f) => `/models/${TRANSLATE_MODEL}/${f}`);
};

/** Which model versions are installed (HEAD requests to our own server). */
export async function checkTranslateModels() {
  const ok = async (q: TranslateQuality) =>
    (
      await Promise.all(
        FILES(q).map((f) =>
          fetch(f, { method: 'HEAD' })
            .then((r) => r.ok && !(r.headers.get('content-type') ?? '').includes('text/html'))
            .catch(() => false),
        ),
      )
    ).every(Boolean);
  useTranslate.setState({ installed: { standard: await ok('standard'), precise: await ok('precise') } });
}

let worker: Worker | null = null;

export function cancelTranslate() {
  worker?.terminate();
  worker = null;
  useTranslate.setState({ trackId: null, stage: 'idle', progress: 0 });
}

/** Translate an English track into a new Persian track (Pro). Resolves when finished. */
export async function translateTrack(trackId: ID, quality: TranslateQuality): Promise<void> {
  if (!requireAi(() => void translateTrack(trackId, quality))) return;
  const project = useProjectStore.getState().history?.present;
  const source = project?.subtitleTracks.find((t) => t.id === trackId);
  if (!source) return;
  const cues = source.cues.filter((c) => c.text.trim());
  if (!cues.length) return;
  cancelTranslate();
  // 16-bit runs best on the GPU; 8-bit on WASM.
  const device = quality === 'precise' ? preferredDevice() : 'wasm';
  useTranslate.setState({ trackId, stage: 'loading', progress: 0, loading: 0, error: undefined, detail: undefined });
  const results: string[] = [];
  await new Promise<void>((resolve) => {
    const w = new Worker(new URL('../../workers/translate.worker.ts', import.meta.url), { type: 'module' });
    worker = w;
    w.onmessage = ({ data }: MessageEvent<TranslateMessage>) => {
      if (worker !== w) return;
      if (data.type === 'loading') useTranslate.setState({ loading: data.progress });
      else if (data.type === 'progress') {
        results.push(...data.results);
        useTranslate.setState({ stage: 'translating', progress: data.done / data.total });
      } else {
        w.terminate();
        worker = null;
        if (data.type === 'error') {
          const missing = /not found|404|Could not locate file|Unauthorized access|is not valid JSON/i.test(data.message);
          useTranslate.setState({ trackId: null, stage: 'error', error: missing ? 'missingModel' : 'failed', detail: data.message });
        } else {
          // Same timing, Persian text (right to left, Persian digits); word timings do not carry over.
          const track = { ...createSubtitleTrack('fa'), rtl: true, style: { ...source.style, digits: 'persian' as const } };
          track.cues = cues.map((c, i) => ({ id: newId(), start: c.start, end: c.end, text: results[i] ?? '' }));
          useProjectStore.getState().edit('ops.translate', (p) => void p.subtitleTracks.push(track));
          useSubtitlesUi.setState({ activeTrackId: track.id });
          useTranslate.setState({ trackId: null, stage: 'done', progress: 1 });
        }
        resolve();
      }
    };
    w.postMessage({ texts: cues.map((c) => c.text.replace(/\n/g, ' ')), from: 'en', to: 'fa', quality, device } satisfies TranslateRequest);
  });
}
