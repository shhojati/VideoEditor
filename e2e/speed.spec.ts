// Speed tools: a ramp preset, reverse (a reversed copy of the media) and a freeze frame, with the
// preview matching the export.
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
});

/** 3 s at 30 fps: red, then green, then blue (one second each). */
async function importRgb(page: Page) {
  const base64 = await page.evaluate(async () => {
    const depPath = '/node_modules/.vite/deps/mediabunny.js';
    const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
    const canvas = new OffscreenCanvas(320, 180);
    const ctx = canvas.getContext('2d')!;
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
    const video = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: mb.QUALITY_HIGH, keyFrameInterval: 1 });
    output.addVideoTrack(video, { frameRate: 30 });
    await output.start();
    for (let n = 0; n < 90; n++) {
      ctx.fillStyle = n < 30 ? '#ff0000' : n < 60 ? '#00ff00' : '#0000ff';
      ctx.fillRect(0, 0, 320, 180);
      await video.add(n / 30, 1 / 30);
    }
    await output.finalize();
    const bytes = new Uint8Array(output.target.buffer!);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  await page.getByTestId('media-input').setInputFiles({ name: 'rgb.mp4', mimeType: 'video/mp4', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]', { hasText: 'rgb.mp4' })).toBeVisible({ timeout: 60_000 });
}

type W = {
  __stores: { transport: { getState: () => { seek: (t: number) => void } } };
  __playback: { render: (t: number) => void };
};
const centrePixel = (page: Page, t: number) =>
  page.evaluate(async (time) => {
    const w = window as unknown as W;
    w.__stores.transport.getState().seek(time);
    await new Promise((r) => setTimeout(r, 700));
    w.__playback.render(time);
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
    const v = c.getBoundingClientRect();
    const f = document.querySelector('[data-testid=preview-frame]')!.getBoundingClientRect();
    const x = Math.round(((f.left + f.width / 2 - v.left) / v.width) * c.width);
    const y = Math.round(((f.top + f.height / 2 - v.top) / v.height) * c.height);
    return Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data.slice(0, 3));
  }, t);
/** Which of red / green / blue a pixel is. */
const hue = (px: number[]) => ['red', 'green', 'blue'][px.indexOf(Math.max(...px))];

test('ramp, reverse and freeze frame; preview = export', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await importRgb(page);
  await page.locator('[data-testid=asset-card]', { hasText: 'rgb.mp4' }).dragTo(page.locator('[data-testid=track][data-track-kind=video] [data-lane]'), { targetPosition: { x: 2, y: 20 } });
  const clipEl = page.locator('[data-testid=clip]').first();
  await clipEl.click({ position: { x: 20, y: 10 } });

  // A ramp preset: Flash in starts at 5× so the clip gets shorter; undo restores it.
  await page.locator('[data-testid=speed-preset][data-kind=flashIn]').click();
  await expect(page.getByTestId('speed-curve')).toBeVisible();
  expect(Number(await clipEl.getAttribute('data-duration'))).toBeLessThan(2);
  await page.getByTestId('timeline').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(clipEl).toHaveAttribute('data-duration', '3.000');

  // Reverse: blue first, red last.
  await clipEl.click({ position: { x: 20, y: 10 } });
  await page.getByTestId('reverse').click();
  await expect(page.getByTestId('reverse')).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
  await expect(page.locator('[data-testid=asset-card]', { hasText: 'reversed' })).toBeVisible();
  expect(hue(await centrePixel(page, 0.3))).toBe('blue');
  expect(hue(await centrePixel(page, 2.7))).toBe('red');

  // Freeze the (green) frame at 1.5 s for 2 s; the rest moves 2 s later.
  await page.evaluate(() => (window as unknown as W).__stores.transport.getState().seek(1.5));
  await page.getByTestId('freeze').click();
  await expect(page.getByTestId('freeze-note')).toBeVisible();
  await expect(page.locator('[data-testid=clip]')).toHaveCount(3);

  const at = [0.3, 2.5, 4.7];
  const preview: number[][] = [];
  for (const t of at) preview.push(await centrePixel(page, t));
  expect(preview.map(hue)).toEqual(['blue', 'green', 'red']);

  await page.getByTestId('open-export').click();
  await page.getByTestId('export-dialog').getByRole('radio', { name: '720p' }).click();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 120_000 });
  const href = await page.getByTestId('export-download').getAttribute('href');
  const exported = await page.evaluate(
    async ({ url, at }) => {
      const depPath = '/node_modules/.vite/deps/mediabunny.js';
      const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
      const input = new mb.Input({ source: new mb.BlobSource(await (await fetch(url!)).blob()), formats: mb.ALL_FORMATS });
      const sink = new mb.CanvasSink((await input.getPrimaryVideoTrack())!, { poolSize: 1 });
      const out: number[][] = [];
      for (const t of at) {
        const c = (await sink.getCanvas(t))!.canvas as OffscreenCanvas;
        out.push(Array.from((c.getContext('2d') as OffscreenCanvasRenderingContext2D).getImageData(c.width >> 1, c.height >> 1, 1, 1).data.slice(0, 3)));
      }
      return out;
    },
    { url: href, at },
  );
  console.log(JSON.stringify({ preview, exported }));
  exported.forEach((px, i) => px.forEach((v, k) => expect(Math.abs(v - preview[i][k]), `${at[i]} s channel ${k}: ${px} vs ${preview[i]}`).toBeLessThan(14)));
});

test('a ramped clip with keep pitch plays in preview and exports at its new length', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  // 4 s test video with a 440 Hz tone.
  const base64 = await page.evaluate(async () => {
    const lib = '/spikes/export-lib.ts';
    const m = await import(/* @vite-ignore */ lib);
    const bytes = new Uint8Array(await (await m.exportTestVideo(4, 320, 180, 30)).blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  await page.getByTestId('media-input').setInputFiles({ name: 'tone.mp4', mimeType: 'video/mp4', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('asset-add').click();
  const clipEl = page.locator('[data-testid=clip]', { hasText: 'tone.mp4' });
  await clipEl.click({ position: { x: 20, y: 10 } });
  await page.locator('[data-testid=speed-preset][data-kind=hero]').click();
  await page.getByTestId('keep-pitch').check();
  const duration = Number(await clipEl.getAttribute('data-duration'));
  expect(duration).toBeLessThan(4);

  await page.getByTestId('play').click();
  await page.waitForTimeout(1500);
  const live = await page.evaluate(() => {
    const pb = (window as unknown as { __playback: { audio: { graph: AudioNode[]; stats: { buffers: number } } } }).__playback;
    return { worklets: pb.audio.graph.filter((n) => n instanceof AudioWorkletNode).length, buffers: pb.audio.stats.buffers };
  });
  await page.getByTestId('play').click();
  expect(live.worklets).toBe(1); // keep pitch
  expect(live.buffers).toBeGreaterThan(0);

  await page.getByTestId('open-export').click();
  await page.getByTestId('export-dialog').getByRole('radio', { name: '720p' }).click();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 120_000 });
  const url = await page.getByTestId('export-download').getAttribute('href');
  const probe = await page.evaluate(async (href) => {
    const depPath = '/node_modules/.vite/deps/mediabunny.js';
    const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
    const input = new mb.Input({ source: new mb.BlobSource(await (await fetch(href!)).blob()), formats: mb.ALL_FORMATS });
    const a = (await input.getPrimaryAudioTrack())!;
    let sum = 0;
    let n = 0;
    for await (const s of new mb.AudioSampleSink(a).samples(0.2, 0.6)) {
      const buf = new Float32Array(s.numberOfFrames);
      s.copyTo(buf, { planeIndex: 0, format: 'f32-planar' });
      for (const v of buf) sum += v * v;
      n += buf.length;
      s.close();
    }
    return { duration: await input.computeDuration(), rms: Math.sqrt(sum / n) };
  }, url);
  console.log(JSON.stringify({ clipDuration: duration, ...probe }));
  expect(Math.abs(probe.duration - duration)).toBeLessThan(0.1);
  expect(probe.rms).toBeGreaterThan(0.05); // the tone is there during the fast part
  expect(errors).toEqual([]);
});
