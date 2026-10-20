/// <reference lib="webworker" />
// Whisper speech-to-text, fully offline: model files and ONNX Runtime WASM come from our own origin
// (public/models, public/wasm), never from the Hugging Face hub or a CDN. Audio never leaves the device.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { DECODER_DTYPE, type SttDevice, type WhisperSize } from '../engine/stt/models';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.backends.onnx.wasm!.wasmPaths = {
  mjs: '/wasm/ort-wasm-simd-threaded.asyncify.mjs',
  wasm: '/wasm/ort-wasm-simd-threaded.asyncify.wasm',
} as never;


export interface SttRequest {
  pcm: Float32Array;
  /** Windows in samples (16 kHz), see engine/stt/windows.ts. */
  windows: { start: number; end: number }[];
  model: WhisperSize;
  device: SttDevice;
  /** ISO code, or null to let Whisper detect it. */
  language: string | null;
}

export type SttMessage =
  | { type: 'loading'; file?: string; progress?: number }
  | { type: 'progress'; done: number; total: number; seconds: number }
  | { type: 'segments'; segments: { start: number; end: number; text: string }[] }
  | { type: 'done'; loadMs: number; runMs: number }
  | { type: 'error'; message: string };

const post = (m: SttMessage) => self.postMessage(m);
const RATE = 16_000;

self.onmessage = async (e: MessageEvent<SttRequest>) => {
  const { pcm, windows, model, device, language } = e.data;
  try {
    const t0 = performance.now();
    const asr = (await pipeline('automatic-speech-recognition', `onnx-community/whisper-${model}`, {
      device,
      dtype: { encoder_model: 'fp32', decoder_model_merged: DECODER_DTYPE[device] },
      progress_callback: (p: { status: string; file?: string; progress?: number }) => {
        if (p.status === 'progress') post({ type: 'loading', file: p.file, progress: p.progress });
      },
    })) as AutomaticSpeechRecognitionPipeline;
    const loadMs = performance.now() - t0;
    const t1 = performance.now();
    const total = windows.reduce((s, w) => s + (w.end - w.start), 0) / RATE;
    let done = 0;
    for (const w of windows) {
      const audio = pcm.subarray(w.start, w.end);
      const out = (await asr(audio, {
        task: 'transcribe',
        ...(language ? { language } : {}),
        return_timestamps: true,
        no_repeat_ngram_size: 4,
      } as never)) as { text: string; chunks?: { timestamp: [number, number | null]; text: string }[] };
      const offset = w.start / RATE;
      const windowEnd = w.end / RATE;
      const chunks = out.chunks?.length ? out.chunks : [{ timestamp: [0, null] as [number, null], text: out.text }];
      post({
        type: 'segments',
        segments: chunks.map((c) => ({
          start: Math.min(windowEnd, offset + c.timestamp[0]),
          end: Math.min(windowEnd, offset + (c.timestamp[1] ?? windowEnd - offset)),
          text: c.text,
        })),
      });
      done += (w.end - w.start) / RATE;
      post({ type: 'progress', done, total, seconds: (performance.now() - t1) / 1000 });
    }
    post({ type: 'done', loadMs, runMs: performance.now() - t1 });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
