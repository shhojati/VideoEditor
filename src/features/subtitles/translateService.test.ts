import { afterEach, describe, expect, it, vi } from 'vitest';
import { createProject, createSubtitleTrack } from '../../model/factories';
import { useAccount } from '../../store/account';
import { useProjectStore } from '../../store/projectStore';
import type { TranslateRequest } from '../../workers/translate.worker';
import { translateTrack, useTranslate } from './translateService';

/** A stand-in for the translation worker: "translates" each text by prefixing it, in batches. */
class FakeWorker {
  onmessage: ((e: MessageEvent) => void) | null = null;
  static last: TranslateRequest | undefined;
  postMessage(req: TranslateRequest) {
    FakeWorker.last = req;
    queueMicrotask(() => {
      const send = (data: unknown) => this.onmessage?.({ data } as MessageEvent);
      for (let i = 0; i < req.texts.length; i += 8)
        send({ type: 'progress', done: Math.min(req.texts.length, i + 8), total: req.texts.length, results: req.texts.slice(i, i + 8).map((t) => `ف:${t}`) });
      send({ type: 'done' });
    });
  }
  terminate() {}
}

function setup() {
  const p = createProject('t');
  const en = { ...createSubtitleTrack('en'), rtl: false };
  en.cues = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, start: i, end: i + 0.8, text: i === 3 ? '  ' : `line ${i}\nmore` }));
  p.subtitleTracks.push(en);
  useProjectStore.getState().load(p);
  return en.id;
}

describe('translateTrack', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('makes a new Persian track with the same timing (Pro)', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    useAccount.setState({ me: { proUntil: Date.now() + 86_400_000 } as never });
    const id = setup();
    await translateTrack(id, 'standard');
    expect(FakeWorker.last).toMatchObject({ from: 'en', to: 'fa', quality: 'standard', device: 'wasm' });
    expect(FakeWorker.last!.texts[0]).toBe('line 0 more'); // line breaks joined
    const tracks = useProjectStore.getState().history!.present.subtitleTracks;
    expect(tracks).toHaveLength(2);
    const fa = tracks[1];
    expect(fa).toMatchObject({ language: 'fa', rtl: true, style: { digits: 'persian' } });
    // The empty cue is skipped; the rest keep their times.
    expect(fa.cues.map((c) => [c.start, c.text])).toEqual(
      [0, 1, 2, 4, 5, 6, 7, 8, 9].map((i) => [i, `ف:line ${i} more`]),
    );
    expect(useTranslate.getState().stage).toBe('done');
  });

  it('asks Free users to upgrade and does nothing', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    useAccount.setState({ me: { proUntil: null } as never });
    const id = setup();
    FakeWorker.last = undefined;
    await translateTrack(id, 'standard');
    expect(FakeWorker.last).toBeUndefined();
    expect(useProjectStore.getState().history!.present.subtitleTracks).toHaveLength(1);
  });
});
