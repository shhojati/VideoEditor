/// <reference lib="webworker" />
// English → Persian subtitle translation, fully offline: M2M100-418M (MIT) through transformers.js,
// with the model and ONNX Runtime served from our own origin like the speech-to-text models.
import { env, pipeline, type TranslationPipeline } from '@huggingface/transformers';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.backends.onnx.wasm!.wasmPaths = {
  mjs: '/wasm/ort-wasm-simd-threaded.asyncify.mjs',
  wasm: '/wasm/ort-wasm-simd-threaded.asyncify.wasm',
} as never;

export const TRANSLATE_MODEL = 'Xenova/m2m100_418M';
/** Standard: 8-bit weights (any device). Precise: 16-bit (best with WebGPU). */
export type TranslateQuality = 'standard' | 'precise';
export const TRANSLATE_DTYPE: Record<TranslateQuality, 'q8' | 'fp16'> = { standard: 'q8', precise: 'fp16' };

export interface TranslateRequest {
  texts: string[];
  from: string;
  to: string;
  quality: TranslateQuality;
  device: 'webgpu' | 'wasm';
}

export type TranslateMessage =
  | { type: 'loading'; progress?: number }
  | { type: 'progress'; done: number; total: number; results: string[] }
  | { type: 'done' }
  | { type: 'error'; message: string };

const post = (m: TranslateMessage) => self.postMessage(m);
const BATCH = 8;

self.onmessage = async (e: MessageEvent<TranslateRequest>) => {
  const { texts, from, to, quality, device } = e.data;
  try {
    const translate = (await pipeline('translation', TRANSLATE_MODEL, {
      device,
      dtype: TRANSLATE_DTYPE[quality],
      progress_callback: (p: { status: string; progress?: number }) => {
        if (p.status === 'progress') post({ type: 'loading', progress: p.progress });
      },
    })) as TranslationPipeline;
    for (let i = 0; i < texts.length; i += BATCH) {
      const batch = texts.slice(i, i + BATCH);
      const out = (await translate(batch, { src_lang: from, tgt_lang: to, max_new_tokens: 160 } as never)) as { translation_text: string }[];
      post({ type: 'progress', done: Math.min(texts.length, i + BATCH), total: texts.length, results: out.map((o) => o.translation_text.trim()) });
    }
    post({ type: 'done' });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
