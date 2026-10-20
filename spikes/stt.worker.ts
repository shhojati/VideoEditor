import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

// Fully offline: models + WASM come from our own origin, never the HF hub / jsDelivr.
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.backends.onnx.wasm!.wasmPaths = {
  mjs: '/wasm/ort-wasm-simd-threaded.asyncify.mjs',
  wasm: '/wasm/ort-wasm-simd-threaded.asyncify.wasm',
} as never;

// Resource timing lists every request the worker made, so the spike can prove nothing leaves our origin.
const fetchedOrigins = () => [...new Set(performance.getEntriesByType('resource').map((e) => new URL(e.name).origin))];

type Req = { audio: Float32Array; model: string; device: 'webgpu' | 'wasm'; language: string };

self.onmessage = async (e: MessageEvent<Req>) => {
  const { audio, model, device, language } = e.data;
  const post = (m: object) => self.postMessage(m);
  try {
    const t0 = performance.now();
    const asr = (await pipeline('automatic-speech-recognition', `onnx-community/whisper-${model}`, {
      device,
      dtype: { encoder_model: 'fp32', decoder_model_merged: device === 'webgpu' ? 'q4' : 'q8' },
      progress_callback: (p: { status: string; file?: string }) =>
        p.status !== 'progress' && p.status !== 'progress_total' && post({ type: 'progress', p }),
    })) as AutomaticSpeechRecognitionPipeline;
    const loadMs = performance.now() - t0;
    const t1 = performance.now();
    const out = await asr(audio, {
      language, task: 'transcribe', return_timestamps: true, chunk_length_s: 30, stride_length_s: 5,
      no_repeat_ngram_size: 4,
    } as never);
    post({ type: 'done', origins: fetchedOrigins(), loadMs, runMs: performance.now() - t1, out });
  } catch (err) {
    post({ type: 'error', message: String((err as Error)?.stack ?? err) });
  }
};
