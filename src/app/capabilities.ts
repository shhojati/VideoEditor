// Startup check of the browser features the editor relies on (plan §2.2, §8).
// AAC is not checked: without a native encoder the bundled WASM one is used (engine/export/aac.ts).
import { canEncodeVideo } from 'mediabunny';

export type CapabilityId =
  | 'secureContext'
  | 'webcodecs'
  | 'h264'
  | 'opfs'
  | 'offscreenCanvas'
  | 'isolation'
  | 'webgpu'
  | 'saveDialog';

export interface Capability {
  id: CapabilityId;
  ok: boolean;
  /** Required features block the app; optional ones only degrade something. */
  required: boolean;
}

const safe = async (f: () => boolean | Promise<boolean>) => {
  try {
    return await f();
  } catch {
    return false;
  }
};

export async function checkCapabilities(): Promise<Capability[]> {
  const g = globalThis as unknown as Record<string, unknown>;
  const webcodecs = ['VideoDecoder', 'VideoEncoder', 'AudioDecoder', 'AudioEncoder', 'VideoFrame'].every((k) => k in g);
  const checks: [CapabilityId, boolean, () => boolean | Promise<boolean>][] = [
    // WebCodecs, OPFS and SharedArrayBuffer only exist on https:// or localhost.
    ['secureContext', true, () => window.isSecureContext],
    ['webcodecs', true, () => webcodecs],
    ['h264', true, async () => webcodecs && (await canEncodeVideo('avc', { width: 1920, height: 1080 }))],
    ['opfs', true, async () => !!(await navigator.storage?.getDirectory?.())],
    ['offscreenCanvas', true, () => typeof OffscreenCanvas !== 'undefined'],
    ['isolation', false, () => window.crossOriginIsolated],
    ['webgpu', false, async () => !!(await (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu?.requestAdapter())],
    ['saveDialog', false, () => 'showSaveFilePicker' in window],
  ];
  return Promise.all(checks.map(async ([id, required, f]) => ({ id, required, ok: await safe(f) })));
}
