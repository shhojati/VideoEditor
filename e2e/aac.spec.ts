import { expect, test } from '@playwright/test';

// Simulates a browser without a native AAC encoder (Firefox, Windows N without the Media Feature
// Pack): the bundled WASM encoder must take over, offline, and still produce AAC audio.
test('AAC is produced by the built-in encoder when the browser has none', async ({ page }) => {
  await page.addInitScript(() => {
    const original = AudioEncoder.isConfigSupported.bind(AudioEncoder);
    AudioEncoder.isConfigSupported = async (config: AudioEncoderConfig) =>
      config.codec.startsWith('mp4a') ? { supported: false, config } : original(config);
    // Persist across reloads in this test only.
    try {
      localStorage.removeItem('onboarding-hidden');
    } catch {
      // ignore
    }
  });
  const foreign: string[] = [];
  page.on('request', (r) => {
    const url = new URL(r.url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname) && !['blob:', 'data:'].includes(url.protocol)) foreign.push(r.url());
  });

  // The WASM encoder runs in an inline blob: worker; seeing one start proves it was used.
  const blobWorkers: string[] = [];
  page.on('worker', (w) => w.url().startsWith('blob:') && blobWorkers.push(w.url()));

  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  const nativeAac = await page.evaluate(async () => (await AudioEncoder.isConfigSupported({ codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 })).supported);
  expect(nativeAac).toBe(false); // the simulation is active

  // The sample project encodes its video (with audio) right here on the main thread.
  await page.getByTestId('load-sample').click();
  await expect(page.locator('[data-testid=asset-card][data-status=ready]')).toBeVisible({ timeout: 60_000 });

  const probe = await page.evaluate(async () => {
    type P = { assets: Record<string, { fileRef: { opfsPath: string }; codecs?: { audio?: string } }> };
    const w = window as unknown as { __stores: { project: { getState: () => { history: { present: P } } } } };
    const asset = Object.values(w.__stores.project.getState().history.present.assets)[0];
    const depPath = '/node_modules/.vite/deps/mediabunny.js';
    const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('media');
    const file = await (await dir.getFileHandle(asset.fileRef.opfsPath.split('/')[1])).getFile();
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const a = (await input.getPrimaryAudioTrack())!;
    let rms = 0;
    let n = 0;
    for await (const s of new mb.AudioSampleSink(a).samples(2, 3)) {
      const buf = new Float32Array(s.numberOfFrames);
      s.copyTo(buf, { planeIndex: 0, format: 'f32-planar' });
      for (const x of buf) {
        rms += x * x;
        n++;
      }
      s.close();
    }
    return { codec: a.codec, metaCodec: asset.codecs?.audio, rms: Math.sqrt(rms / Math.max(1, n)) };
  });
  expect(probe.codec).toBe('aac');
  expect(probe.metaCodec).toBe('aac');
  expect(probe.rms).toBeGreaterThan(0.02); // the sample's soft chord, not silence
  expect(blobWorkers.length).toBeGreaterThan(0);
  expect(foreign).toEqual([]);
});
