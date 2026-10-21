// Auto ducking: a music clip set to "duck under voice" gets quieter in the export exactly where the
// voice clip has sound, and not elsewhere.
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
});

/** 16-bit mono WAV at 48 kHz from a sample function. */
function wav(seconds: number, sample: (t: number) => number): Buffer {
  const rate = 48_000;
  const n = Math.round(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample(i / rate))) * 32767), 44 + i * 2);
  return buf;
}

type W = {
  __stores: { project: { getState: () => { history: { present: { assets: Record<string, { id: string; name: string }> } } } } };
};

test('music ducks under the voice in the export', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();

  const music = wav(6, (t) => 0.5 * Math.sin(2 * Math.PI * 220 * t));
  // A quiet "voice" from 2 to 4 s: the threshold adapts to the recording's own level.
  const voice = wav(6, (t) => (t >= 2 && t < 4 ? 0.05 * Math.sin(2 * Math.PI * 660 * t) : 0));
  await page.getByTestId('media-input').setInputFiles([
    { name: 'music.wav', mimeType: 'audio/wav', buffer: music },
    { name: 'voice.wav', mimeType: 'audio/wav', buffer: voice },
  ]);
  await expect(page.locator('[data-testid=asset-card][data-status=ready]')).toHaveCount(2, { timeout: 60_000 });

  // Each on its own track at 0 s; wait for the waveforms the speech detection uses.
  await page.evaluate(async () => {
    const lib = '/src/features/timeline/interactions.ts';
    const media = '/src/features/media-bin/mediaService.ts';
    const { placeAssetAt } = await import(/* @vite-ignore */ lib);
    const { useMedia } = await import(/* @vite-ignore */ media);
    const assets = Object.values((window as unknown as W).__stores.project.getState().history.present.assets);
    for (const name of ['music.wav', 'voice.wav']) placeAssetAt(assets.find((a) => a.name === name)!.id, null, 0);
    for (let i = 0; i < 100 && !assets.every((a) => useMedia.getState().assets[a.id]?.waveform); i++) await new Promise((r) => setTimeout(r, 100));
  });

  await page.locator('[data-testid=clip]', { hasText: 'music.wav' }).click({ position: { x: 20, y: 10 } });
  await page.getByTestId('duck-toggle').check();
  await expect(page.getByTestId('clip-inspector').getByText('Duck by')).toBeVisible();
  await expect(page.locator('[data-testid=clip]', { hasText: 'music.wav' }).getByTestId('duck-badge')).toHaveText('↓ -12 dB');

  await page.getByTestId('open-export').click();
  await page.getByTestId('export-dialog').getByRole('radio', { name: '720p' }).click();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 120_000 });
  const url = await page.getByTestId('export-download').getAttribute('href');

  const rms = await page.evaluate(async (href) => {
    const depPath = '/node_modules/.vite/deps/mediabunny.js';
    const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
    const input = new mb.Input({ source: new mb.BlobSource(await (await fetch(href!)).blob()), formats: mb.ALL_FORMATS });
    const sink = new mb.AudioSampleSink((await input.getPrimaryAudioTrack())!);
    const level = async (from: number, to: number) => {
      let sum = 0;
      let n = 0;
      for await (const s of sink.samples(from, to)) {
        const buf = new Float32Array(s.numberOfFrames);
        s.copyTo(buf, { planeIndex: 0, format: 'f32-planar' });
        for (const v of buf) sum += v * v;
        n += buf.length;
        s.close();
      }
      return Math.sqrt(sum / n);
    };
    return { before: await level(0.5, 1.5), during: await level(2.5, 3.5), after: await level(4.8, 5.6) };
  }, url);
  console.log(JSON.stringify(rms));
  // Music alone ≈ 0.35 RMS; under the voice it is 12 dB down (plus the quiet voice).
  expect(rms.before).toBeGreaterThan(0.3);
  expect(rms.after).toBeGreaterThan(0.3);
  expect(rms.during).toBeLessThan(rms.before * 0.4);
});
