import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
});

/** A solid-colour clip with a pure tone, encoded in the page; imported through the media input. */
async function importSolid(page: Page, name: string, color: string, freq: number, seconds = 3) {
  const base64 = await page.evaluate(
    async ({ color, freq, seconds }) => {
      const depPath = '/node_modules/.vite/deps/mediabunny.js';
      const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
      const canvas = new OffscreenCanvas(640, 360);
      const ctx = canvas.getContext('2d')!;
      const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
      const video = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: mb.QUALITY_HIGH });
      const audio = new mb.AudioBufferSource({ codec: 'aac', bitrate: 128_000 });
      output.addVideoTrack(video, { frameRate: 30 });
      output.addAudioTrack(audio);
      await output.start();
      const rate = 48_000;
      const buf = new AudioBuffer({ length: rate * seconds, numberOfChannels: 1, sampleRate: rate });
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = 0.3 * Math.sin((2 * Math.PI * freq * i) / rate);
      await audio.add(buf);
      for (let n = 0; n < seconds * 30; n++) {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 640, 360);
        await video.add(n / 30, 1 / 30);
      }
      await output.finalize();
      const bytes = new Uint8Array(output.target.buffer!);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    { color, freq, seconds },
  );
  await page.getByTestId('media-input').setInputFiles({ name, mimeType: 'video/mp4', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]', { hasText: name })).toBeVisible({ timeout: 60_000 });
}

/** Centre pixel of the preview after drawing time t directly (rAF-independent). */
const previewPixel = (page: Page, t: number) =>
  page.evaluate(async (time) => {
    type W = { __stores: { transport: { getState: () => { seek: (t: number) => void } } }; __playback: { render: (t: number) => void } };
    const w = window as unknown as W;
    w.__stores.transport.getState().seek(time);
    await new Promise((r) => setTimeout(r, 600)); // exact frames decode
    w.__playback.render(time);
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
    return Array.from(c.getContext('2d')!.getImageData(c.width >> 1, c.height >> 1, 1, 1).data.slice(0, 3));
  }, t);

test('crossfade dropped on a cut: preview = export, equal-power audio; dip to black; undo', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await importSolid(page, 'red.mp4', '#ff0000', 440);
  await importSolid(page, 'blue.mp4', '#0000ff', 660);

  // Red then blue on the video track, touching at 3 s (drop blue onto the end of red).
  const lane = page.locator('[data-testid=track][data-track-kind=video] [data-lane]');
  await page.locator('[data-testid=asset-card]', { hasText: 'red.mp4' }).dragTo(lane, { targetPosition: { x: 2, y: 20 } });
  await page.locator('[data-testid=asset-card]', { hasText: 'blue.mp4' }).dragTo(lane, { targetPosition: { x: 3 * 40 + 4, y: 20 } });
  await expect(lane.getByTestId('clip')).toHaveCount(2);
  // Give both clips 0.5 s of spare media at the cut (handles) so the audio can crossfade fully:
  // red plays 0–2.5 s of its 3 s, blue starts 0.5 s into its media; they touch at 2.5 s.
  await page.evaluate(() => {
    type C = { start: number; duration: number; inPoint: number };
    type W = { __stores: { project: { getState: () => { edit: (l: string, r: (p: { tracks: { kind: string; clips: C[] }[] }) => void) => void } } } };
    (window as unknown as W).__stores.project.getState().edit('test', (p) => {
      const [red, blue] = p.tracks.find((t) => t.kind === 'video')!.clips;
      red.duration = 2.5;
      Object.assign(blue, { start: 2.5, inPoint: 0.5, duration: 2.5 });
    });
  });
  await expect(page.getByTestId('cut-handle')).toHaveCount(1);

  // Drag "Crossfade" from the Transitions tab onto the cut.
  await page.getByTestId('tab-transitions').click();
  await page.getByTestId('transition-crossfade').dragTo(lane, { targetPosition: { x: 2.5 * 40, y: 20 } });
  await expect(page.getByTestId('transition-badge')).toHaveAttribute('data-kind', 'crossfade');
  // 1 s long, set in the inspector.
  const duration = page.getByTestId('transition-inspector').getByRole('textbox', { name: 'Duration' });
  await duration.fill('1');
  await duration.press('Enter');
  await expect(page.getByTestId('transition-badge')).toHaveAttribute('data-duration', '1.000');

  // Preview: red before, purple in the middle of the window, blue after.
  const [before, mid, after] = [await previewPixel(page, 1.5), await previewPixel(page, 2.5), await previewPixel(page, 3.5)];
  expect(before[0]).toBeGreaterThan(230);
  expect(after[2]).toBeGreaterThan(230);
  expect(mid[0]).toBeGreaterThan(100);
  expect(mid[0]).toBeLessThan(160);
  expect(mid[2]).toBeGreaterThan(100);
  expect(mid[2]).toBeLessThan(160);

  // Export and probe the same moments.
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-dialog').getByRole('radio', { name: '720p' }).click();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 90_000 });
  const href = await page.getByTestId('export-download').getAttribute('href');
  const probe = await page.evaluate(async (url) => {
    const depPath = '/node_modules/.vite/deps/mediabunny.js';
    const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
    const blob = await (await fetch(url!)).blob();
    const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    const sink = new mb.CanvasSink((await input.getPrimaryVideoTrack())!, { poolSize: 1 });
    const px = async (t: number) => {
      const fr = (await sink.getCanvas(t))!;
      const c = fr.canvas as HTMLCanvasElement | OffscreenCanvas;
      return Array.from((c.getContext('2d') as CanvasRenderingContext2D).getImageData(c.width >> 1, c.height >> 1, 1, 1).data.slice(0, 3));
    };
    const rmsAt = async (a: number, b: number) => {
      let s = 0;
      let n = 0;
      for await (const smp of new mb.AudioSampleSink((await input.getPrimaryAudioTrack())!).samples(a, b)) {
        const buf = new Float32Array(smp.numberOfFrames);
        smp.copyTo(buf, { planeIndex: 0, format: 'f32-planar' });
        for (const x of buf) {
          s += x * x;
          n++;
        }
        smp.close();
      }
      return Math.sqrt(s / Math.max(1, n));
    };
    return {
      duration: await input.computeDuration(),
      before: await px(1.5),
      mid: await px(2.5),
      after: await px(3.5),
      rmsBefore: await rmsAt(1, 1.5),
      rmsCut: await rmsAt(2.4, 2.6),
      rmsAfter: await rmsAt(3.5, 4),
    };
  }, href);
  console.log(JSON.stringify({ preview: { before, mid, after }, probe }));
  expect(Math.abs(probe.duration - 5)).toBeLessThan(0.05); // the timeline did not get longer or shorter
  for (const ch of [0, 2]) expect(Math.abs(probe.mid[ch] - mid[ch])).toBeLessThan(20); // preview = export
  expect(probe.before[0]).toBeGreaterThan(230);
  expect(probe.after[2]).toBeGreaterThan(230);
  // Equal power: the level at the cut matches the level on either side (a linear fade would dip ~3 dB).
  expect(probe.rmsCut / probe.rmsBefore).toBeGreaterThan(0.9);
  expect(probe.rmsCut / probe.rmsBefore).toBeLessThan(1.1);
  expect(probe.rmsAfter / probe.rmsBefore).toBeGreaterThan(0.9);
  await page.getByRole('button', { name: 'Close' }).click();

  // Switch to dip to black: the middle of the window is (almost) black; undo brings the crossfade back.
  await page.getByTestId('transition-badge').click();
  await page.getByTestId('pick-dipBlack').click();
  await expect(page.getByTestId('transition-badge')).toHaveAttribute('data-kind', 'dipBlack');
  const dip = await previewPixel(page, 2.5);
  expect(Math.max(...dip)).toBeLessThan(20);
  await page.getByTestId('timeline').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('transition-badge')).toHaveAttribute('data-kind', 'crossfade');

  // Moving the blue clip away removes the transition (the clips no longer touch).
  const blue = lane.getByTestId('clip').nth(1);
  const box = (await blue.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 5 });
  await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(page.getByTestId('transition-badge')).toHaveCount(0);
});
