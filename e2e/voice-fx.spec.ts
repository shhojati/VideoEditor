import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
});

async function importBlob(page: Page, make: string, name: string, mimeType: string) {
  const base64 = await page.evaluate(async (code) => {
    const blob: Blob = await new Function(`return (async () => { ${code} })()`)();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, make);
  await page.getByTestId('media-input').setInputFiles({ name, mimeType, buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]', { hasText: name })).toBeVisible({ timeout: 60_000 });
}

test('voice effects: chipmunk + echo from the inspector play in preview and double the pitch in export', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const errors: string[] = [];
  page.on('console', (m) => (m.type() === 'error' || m.text().includes('voice effects unavailable')) && errors.push(m.text()));
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();

  // 4 s test video with a 440 Hz tone.
  await importBlob(page, `const m = await import('/spikes/export-lib.ts'); return (await m.exportTestVideo(4, 320, 180, 30)).blob;`, 'tone.mp4', 'video/mp4');
  await page.getByTestId('asset-add').click();
  await page.locator('[data-testid=clip]', { hasText: 'tone.mp4' }).click({ position: { x: 20, y: 10 } });

  await page.locator('[data-testid=voice-preset][data-kind=chipmunk]').click();
  await page.locator('[data-testid=space-preset][data-kind=echo]').click();
  await expect(page.locator('[data-testid=voice-preset][data-kind=chipmunk]')).toHaveAttribute('aria-checked', 'true');
  const audio = await page.evaluate(() => {
    type W = { __stores: { project: { getState: () => { history: { present: { tracks: { clips: { audio: unknown }[] }[] } } } } } };
    const p = (window as unknown as W).__stores.project.getState().history.present;
    return p.tracks.flatMap((t) => t.clips)[0].audio;
  });
  expect(audio).toMatchObject({ voice: { kind: 'chipmunk', pitch: 12 }, space: { kind: 'echo' } });

  // Preview: the clip plays through the effect worklets.
  await page.getByTestId('play').click();
  await page.waitForTimeout(1500);
  const live = await page.evaluate(() => {
    const pb = (window as unknown as { __playback: { audio: { graph: AudioNode[]; stats: { buffers: number } } } }).__playback;
    return { worklets: pb.audio.graph.filter((n) => n instanceof AudioWorkletNode).length, buffers: pb.audio.stats.buffers };
  });
  await page.getByTestId('play').click();
  expect(live.worklets).toBe(2);
  expect(live.buffers).toBeGreaterThan(0);

  await page.getByTestId('open-export').click();
  await page.getByTestId('export-dialog').getByRole('radio', { name: '720p' }).click();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 120_000 });
  const url = await page.getByTestId('export-download').getAttribute('href');

  const probe = await page.evaluate(async (href) => {
    const depPath = '/node_modules/.vite/deps/mediabunny.js';
    const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
    const blob = await (await fetch(href!)).blob();
    const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    const a = (await input.getPrimaryAudioTrack())!;
    const samples: number[] = [];
    let rate = 0;
    for await (const s of new mb.AudioSampleSink(a).samples(1, 3)) {
      const buf = new Float32Array(s.numberOfFrames);
      s.copyTo(buf, { planeIndex: 0, format: 'f32-planar' });
      samples.push(...buf);
      rate = s.sampleRate;
      s.close();
    }
    let up = 0;
    for (let i = 1; i < samples.length; i++) if (samples[i - 1] < 0 && samples[i] >= 0) up++;
    return { duration: await input.computeDuration(), hz: up / (samples.length / rate) };
  }, url);
  console.log(JSON.stringify(probe));

  expect(Math.abs(probe.duration - 4)).toBeLessThan(0.1);
  expect(probe.hz).toBeGreaterThan(860); // 440 Hz an octave up
  expect(probe.hz).toBeLessThan(900);
  expect(errors).toEqual([]);
});
