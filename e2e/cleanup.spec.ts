// Audio cleanup: noise reduction runs in the preview worklet and in the export, Normalize sets a
// gain from the measured loudness.
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
});

/** 16-bit mono WAV at 48 kHz from a sample function. */
function wav(seconds: number, sample: (t: number, i: number) => number): Buffer {
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
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample(i / rate, i))) * 32767), 44 + i * 2);
  return buf;
}

test('noise reduction and normalize, in preview and export', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();

  // Steady hiss all along; a 440 Hz tone from 3 s.
  let seed = 1;
  const hiss = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return ((seed / 0x7fffffff) * 2 - 1) * 0.05;
  };
  const file = wav(6, (t) => hiss() + (t >= 3 ? 0.3 * Math.sin(2 * Math.PI * 440 * t) : 0));
  await page.getByTestId('media-input').setInputFiles({ name: 'noisy.wav', mimeType: 'audio/wav', buffer: file });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('asset-add').click();
  await page.locator('[data-testid=clip]', { hasText: 'noisy.wav' }).click({ position: { x: 20, y: 10 } });

  const inspector = page.getByTestId('clip-inspector');
  const box = inspector.getByRole('textbox', { name: 'Noise reduction', exact: true });
  await box.fill('100');
  await box.press('Enter');
  await inspector.getByTestId('normalize').click();
  await expect(inspector.getByTestId('gain-db')).toBeVisible({ timeout: 30_000 });
  const gainDb = Number((await inspector.getByTestId('gain-db').innerText()).replace(/[^\d.+-]/g, ''));
  expect(gainDb).not.toBe(0);

  // Preview: the cleanup runs in the voice worklet.
  await page.getByTestId('play').click();
  await page.waitForTimeout(1500);
  const worklets = await page.evaluate(() => {
    const pb = (window as unknown as { __playback: { audio: { graph: AudioNode[] } } }).__playback;
    return pb.audio.graph.filter((n) => n instanceof AudioWorkletNode).length;
  });
  await page.getByTestId('play').click();
  expect(worklets).toBe(1);

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
    return { hiss: await level(0.8, 2.6), tone: await level(3.6, 5.6) };
  }, url);
  console.log(JSON.stringify({ gainDb, ...rms }));
  const gain = 10 ** (gainDb / 20);
  // The raw hiss is ~0.029 RMS; at least 16 dB of it is gone (gain applied to both).
  expect(rms.hiss).toBeLessThan(0.029 * gain * 0.16);
  // The tone (0.21 RMS) keeps its level, times the normalize gain.
  expect(rms.tone).toBeGreaterThan(0.212 * gain * 0.8);
  expect(rms.tone).toBeLessThan(0.212 * gain * 1.2);
  expect(errors).toEqual([]);
});
