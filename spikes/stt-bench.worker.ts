/// <reference lib="webworker" />
// Benchmark copy of src/workers/stt.worker.ts with the decoder precision as a parameter.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';

env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = '/models/';
env.backends.onnx.wasm!.wasmPaths = {
  mjs: '/wasm/ort-wasm-simd-threaded.asyncify.mjs',
  wasm: '/wasm/ort-wasm-simd-threaded.asyncify.wasm',
} as never;

export interface BenchRequest {
  pcm: Float32Array;
  windows: { start: number; end: number }[];
  model: string;
  device: 'webgpu' | 'wasm';
  encoder: 'fp32' | 'fp16' | 'q8' | 'q4';
  decoder: 'q4' | 'q8' | 'fp16' | 'fp32';
  words: boolean;
}

self.onmessage = async (e: MessageEvent<BenchRequest>) => {
  const { pcm, windows, model, device, encoder, decoder, words } = e.data;
  try {
    const t0 = performance.now();
    const asr = (await pipeline('automatic-speech-recognition', `onnx-community/whisper-${model}${words ? '_timestamped' : ''}`, {
      device,
      dtype: { model: encoder, encoder_model: encoder, decoder_model_merged: decoder },
    })) as AutomaticSpeechRecognitionPipeline;
    const loadMs = performance.now() - t0;
    const t1 = performance.now();
    const texts: string[] = [];
    for (const w of windows) {
      const out = (await asr(pcm.subarray(w.start, w.end), {
        task: 'transcribe',
        language: 'fa',
        return_timestamps: words ? 'word' : true,
        no_repeat_ngram_size: 4,
      } as never)) as { text: string };
      texts.push(out.text);
    }
    self.postMessage({ ok: true, texts, loadMs, runMs: performance.now() - t1 });
  } catch (err) {
    self.postMessage({ ok: false, message: String((err as Error)?.stack ?? err) });
  }
};
