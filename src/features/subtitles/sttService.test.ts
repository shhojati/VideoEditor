import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, createTrack } from '../../model/factories';
import { createClip } from '../../model/timeline';
import type { Asset } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import type { SttRequest } from '../../workers/stt.worker';
import { startAutoSubtitles, useStt } from './sttService';

// 3 s of "speech" (a loud tone), so there is one window to transcribe; `silent` gives what an
// Android decoder that yields nothing would.
const mix = vi.hoisted(() => ({ silent: false }));
vi.mock('../media-bin/mediaService', () => ({
  mediaWorker: () => ({
    mixdown16k: async () =>
      mix.silent
        ? { pcm: new Float32Array(48_000), stats: [{ codec: 'aac', frames: 0, used: 0, peak: 0, retried: true }] }
        : { pcm: Float32Array.from({ length: 48_000 }, (_, i) => 0.3 * Math.sin(i / 5)), stats: [] },
  }),
}));

/** A stand-in for the speech worker; `behave` decides what happens to each request. */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  onerror: ((e: Partial<ErrorEvent>) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  static behave: (w: FakeWorker, req: SttRequest) => void;
  static requests: SttRequest[] = [];
  send(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
  crash(message = '') {
    this.onerror?.({ message, preventDefault() {} });
  }
  postMessage(req: SttRequest) {
    FakeWorker.requests.push(req);
    queueMicrotask(() => FakeWorker.behave(this, req));
  }
  terminate() {}
}

function setup() {
  const audio: Asset = { id: 'a', kind: 'audio', name: 'a.mp3', duration: 3, fileRef: { opfsPath: 'a.mp3' } };
  const p = createProject('t');
  p.assets = { a: audio };
  p.tracks = [createTrack('audio')];
  p.tracks[0].clips = [{ ...createClip(audio, 0), id: 'c' }];
  useProjectStore.getState().load(p);
  FakeWorker.requests = [];
  vi.stubGlobal('Worker', FakeWorker);
}

const run = (device: 'webgpu' | 'wasm') => {
  vi.stubGlobal('navigator', device === 'webgpu' ? { gpu: {} } : {});
  return startAutoSubtitles({ model: 'tiny', language: 'fa', selectedOnly: false });
};

describe('startAutoSubtitles when the worker breaks', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reports a worker that crashes (e.g. out of memory) instead of waiting forever', async () => {
    setup();
    FakeWorker.behave = (w) => w.crash();
    await run('wasm');
    expect(useStt.getState()).toMatchObject({ stage: 'error', error: 'failed', detail: expect.stringMatching(/memory/) });
  });

  it('reports a worker script that fails to load', async () => {
    setup();
    FakeWorker.behave = (w) => w.crash('Failed to fetch a dynamically imported module');
    await run('wasm');
    expect(useStt.getState()).toMatchObject({ stage: 'error', error: 'failed', detail: 'Failed to fetch a dynamically imported module' });
  });

  it('retries on WASM when the worker crashes on WebGPU', async () => {
    setup();
    FakeWorker.behave = (w, req) => {
      if (req.device === 'webgpu') return w.crash();
      w.send({ type: 'segments', segments: [{ start: 0.2, end: 2.5, text: 'سلام دنیا' }] });
      w.send({ type: 'done', loadMs: 1, runMs: 1 });
    };
    await run('webgpu');
    expect(FakeWorker.requests.map((r) => r.device)).toEqual(['webgpu', 'wasm']);
    expect(useStt.getState()).toMatchObject({ stage: 'done', created: 1 });
  });
});

describe('startAutoSubtitles when the audio decodes to silence', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mix.silent = false;
  });

  it('says what the decoder gave instead of only "no audio"', async () => {
    setup();
    mix.silent = true;
    await run('wasm');
    expect(FakeWorker.requests).toEqual([]);
    expect(useStt.getState()).toMatchObject({ stage: 'error', error: 'noAudio', detail: '1: aac, 0/0 frames, ts -, peak 0 (retried)' });
  });
});
