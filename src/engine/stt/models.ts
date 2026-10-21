// Whisper model files the app can use; must match scripts/fetch-models.mjs.

export type WhisperSize = 'tiny' | 'base' | 'small';
export type SttDevice = 'webgpu' | 'wasm';

export const WHISPER_SIZES: WhisperSize[] = ['tiny', 'base', 'small'];

/** Decoder weights per device (q4 runs well on WebGPU, q8 on WASM). The encoder is always fp32. */
export const DECODER_DTYPE: Record<SttDevice, 'q4' | 'q8'> = { webgpu: 'q4', wasm: 'q8' };
const DECODER_FILE: Record<SttDevice, string> = {
  webgpu: 'decoder_model_merged_q4.onnx',
  wasm: 'decoder_model_merged_quantized.onnx',
};

/**
 * Model repo name. The "_timestamped" exports also output cross-attentions, which word-level
 * timestamps need; the plain ones (older installs) give segment times only.
 */
export const modelName = (size: WhisperSize, words: boolean) => `whisper-${size}${words ? '_timestamped' : ''}`;
export const modelDir = (size: WhisperSize, words = true) => `/models/onnx-community/${modelName(size, words)}`;

/** Files a model needs on this device, relative to the site root. */
export function requiredFiles(size: WhisperSize, device: SttDevice, words = true): string[] {
  const dir = modelDir(size, words);
  return [
    `${dir}/config.json`,
    `${dir}/tokenizer.json`,
    `${dir}/preprocessor_config.json`,
    `${dir}/onnx/encoder_model.onnx`,
    `${dir}/onnx/${DECODER_FILE[device]}`,
  ];
}

export const preferredDevice = (): SttDevice =>
  typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm';
