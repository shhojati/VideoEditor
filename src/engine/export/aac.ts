// AAC everywhere: use the browser's encoder when it has one (Chrome/Edge on standard Windows), else
// register the bundled WebAssembly AAC encoder (@mediabunny/aac-encoder, libavcodec, MPL-2.0).
// The fallback is ~1 MB with its WASM embedded (no network requests) and is only loaded when needed:
// Firefox, Windows N/KN editions without the Media Feature Pack, some Chromium builds.
import { canEncodeAudio } from 'mediabunny';

export type AacSource = 'native' | 'wasm';

let ready: Promise<AacSource> | null = null;

/** Call before encoding AAC. Idempotent per JS context (main thread and each worker separately). */
export function ensureAacEncoder(): Promise<AacSource> {
  ready ??= (async () => {
    if (await canEncodeAudio('aac')) return 'native';
    const { registerAacEncoder } = await import('@mediabunny/aac-encoder');
    registerAacEncoder();
    return 'wasm';
  })();
  return ready;
}
