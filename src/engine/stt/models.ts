// Whisper model files the app can use; must match scripts/fetch-models.mjs.

export type WhisperSize = 'tiny' | 'base' | 'small' | 'large-v3-turbo';
export type SttDevice = 'webgpu' | 'wasm';
type Dtype = 'fp32' | 'q8' | 'q4';

/** Smallest to most accurate. */
export const WHISPER_SIZES: WhisperSize[] = ['tiny', 'base', 'small', 'large-v3-turbo'];

/**
 * Weights per model and device: decoders q4 on WebGPU, q8 on WASM; encoders fp32, except turbo's
 * (2.5 GB in fp32), which is quantized the same way as its decoder. fp16 is not used: many GPUs
 * (e.g. older NVIDIA) cannot run it. Persian accuracy of these choices: docs/SPIKES.md, spike 4b.
 */
export function dtypes(size: WhisperSize, device: SttDevice): { encoder: Dtype; decoder: Dtype } {
  const decoder = device === 'webgpu' ? 'q4' : 'q8';
  return { encoder: size === 'large-v3-turbo' ? decoder : 'fp32', decoder };
}

const SUFFIX: Record<Dtype, string> = { fp32: '', q8: '_quantized', q4: '_q4' };

/**
 * Model repo name. The "_timestamped" exports also output cross-attentions, which word-level
 * timestamps need; the plain ones (older installs) give segment times only.
 */
export const modelName = (size: WhisperSize, words: boolean) => `whisper-${size}${words ? '_timestamped' : ''}`;
export const modelDir = (size: WhisperSize, words = true) => `/models/onnx-community/${modelName(size, words)}`;

/** Files a model needs on this device, relative to the site root. */
export function requiredFiles(size: WhisperSize, device: SttDevice, words = true): string[] {
  const dir = modelDir(size, words);
  const { encoder, decoder } = dtypes(size, device);
  return [
    `${dir}/config.json`,
    `${dir}/tokenizer.json`,
    `${dir}/preprocessor_config.json`,
    `${dir}/onnx/encoder_model${SUFFIX[encoder]}.onnx`,
    `${dir}/onnx/decoder_model_merged${SUFFIX[decoder]}.onnx`,
  ];
}

export const preferredDevice = (): SttDevice =>
  typeof navigator !== 'undefined' && 'gpu' in navigator ? 'webgpu' : 'wasm';

/** Phones and tablets, where small and turbo (over 1 GB while running) tend to get the tab closed. */
export function isPhone(): boolean {
  if (typeof navigator === 'undefined') return false;
  const nav = navigator as Navigator & { userAgentData?: { mobile?: boolean } };
  return nav.userAgentData?.mobile || /Android|iPhone|iPad|Mobi/i.test(nav.userAgent ?? '');
}

/** Too big for a phone's memory (see isPhone). */
export const heavyModel = (size: WhisperSize) => size === 'small' || size === 'large-v3-turbo';

/**
 * Model to start with: the most accurate installed one (turbo, then small; docs/SPIKES.md), but
 * base on a phone. `installed` is what checkModels found (turbo only once it is known to be there).
 */
export function defaultSize(installed: Partial<Record<WhisperSize, boolean>> = {}): WhisperSize {
  if (isPhone()) return 'base';
  return installed['large-v3-turbo'] ? 'large-v3-turbo' : 'small';
}
