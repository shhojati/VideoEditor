// Compound clips: make one, change it as a whole, open it and edit inside, go back out; markers.
// The export draws compounds like the preview.
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
});

async function importSolid(page: Page, name: string, color: string) {
  const base64 = await page.evaluate(async (color) => {
    const depPath = '/node_modules/.vite/deps/mediabunny.js';
    const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
    const canvas = new OffscreenCanvas(640, 360);
    const ctx = canvas.getContext('2d')!;
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
    const video = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: mb.QUALITY_HIGH });
    output.addVideoTrack(video, { frameRate: 30 });
    await output.start();
    for (let n = 0; n < 60; n++) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 640, 360);
      await video.add(n / 30, 1 / 30);
    }
    await output.finalize();
    const bytes = new Uint8Array(output.target.buffer!);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, color);
  await page.getByTestId('media-input').setInputFiles({ name, mimeType: 'video/mp4', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]', { hasText: name })).toBeVisible({ timeout: 60_000 });
}

type W = {
  __stores: {
    transport: { getState: () => { seek: (t: number) => void } };
    project: { getState: () => { history: { present: { markers?: { t: number; label?: string; color?: string }[]; tracks: { kind: string; clips: { id: string; sequenceId?: string }[] }[] } } } };
  };
  __playback: { render: (t: number) => void };
};
const centrePixel = (page: Page, t: number) =>
  page.evaluate(async (time) => {
    const w = window as unknown as W;
    w.__stores.transport.getState().seek(time);
    await new Promise((r) => setTimeout(r, 600));
    w.__playback.render(time);
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
    const v = c.getBoundingClientRect();
    const f = document.querySelector('[data-testid=preview-frame]')!.getBoundingClientRect();
    const x = Math.round(((f.left + f.width / 2 - v.left) / v.width) * c.width);
    const y = Math.round(((f.top + f.height / 2 - v.top) / v.height) * c.height);
    return Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data.slice(0, 3));
  }, t);

test('compound clip: make, change as a whole, edit inside, export', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await importSolid(page, 'red.mp4', '#ff0000');
  await importSolid(page, 'blue.mp4', '#0000ff');
  const lane = page.locator('[data-testid=track][data-track-kind=video] [data-lane]').first();
  await page.locator('[data-testid=asset-card]', { hasText: 'red.mp4' }).dragTo(lane, { targetPosition: { x: 2, y: 20 } });
  await page.locator('[data-testid=asset-card]', { hasText: 'blue.mp4' }).dragTo(lane, { targetPosition: { x: 82, y: 20 } }); // 2 s, snapping to the red clip's end
  const clips = page.locator('[data-testid=clip]');
  await expect(clips).toHaveCount(2);

  // Select both and make a compound clip.
  await clips.nth(0).click({ position: { x: 10, y: 10 } });
  await clips.nth(1).click({ position: { x: 10, y: 10 }, modifiers: ['Shift'] });
  await page.getByTestId('make-compound').click();
  await expect(clips).toHaveCount(1);
  await expect(clips.first()).toContainText('Compound 1');
  const red = await centrePixel(page, 1);
  expect(red[0]).toBeGreaterThan(240);
  expect(red[1] + red[2]).toBeLessThan(20);
  expect((await centrePixel(page, 3))[2]).toBeGreaterThan(240);

  // Changed as a whole: half opacity.
  await clips.first().click({ position: { x: 10, y: 10 } });
  const opacity = page.getByTestId('clip-inspector').getByRole('textbox', { name: 'Opacity', exact: true });
  await opacity.fill('50');
  await opacity.press('Enter');
  const half = await centrePixel(page, 1);
  expect(Math.abs(half[0] - 128)).toBeLessThan(4);

  // Open it: its two clips; delete the blue one; back out.
  await clips.first().dblclick({ position: { x: 10, y: 10 } });
  await expect(page.getByTestId('compound-path')).toContainText('Compound 1');
  await expect(clips).toHaveCount(2);
  await clips.nth(1).click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('Delete');
  await expect(clips).toHaveCount(1);
  await page.getByTestId('compound-exit').click();
  await expect(page.getByTestId('compound-path')).toHaveCount(0);
  await expect(clips).toHaveCount(1);
  expect(await centrePixel(page, 3)).toEqual([0, 0, 0]); // nothing left inside after 2 s

  // Markers: add at 1 s, name and colour it.
  await page.getByTestId('timeline').click({ position: { x: 5, y: 5 } });
  await page.evaluate(() => (window as unknown as W).__stores.transport.getState().seek(1));
  await page.keyboard.press('m');
  await page.getByTestId('markers-menu').click();
  const list = page.getByTestId('markers-list');
  await list.getByRole('textbox', { name: 'Name' }).fill('Intro');
  await list.getByRole('button', { name: 'Colour' }).nth(1).click();
  const markers = await page.evaluate(() => (window as unknown as W).__stores.project.getState().history.present.markers);
  expect(markers).toEqual([expect.objectContaining({ t: 1, label: 'Intro', color: '#ef4444' })]);
  await page.getByTestId('markers-menu').click();

  const at = [1, 3];
  const preview = [half, [0, 0, 0]];
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-dialog').getByRole('radio', { name: '720p' }).click();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 90_000 });
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

test('sound inside a compound clip plays, at the compound volume', async ({ page }) => {
  test.setTimeout(2 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  // 4 s test video with a 440 Hz tone (~0.155 RMS at full volume), and a title over it.
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
  await page.evaluate(() => (window as unknown as W).__stores.transport.getState().seek(0));
  await page.getByTestId('btn-add-text').click();
  await page.keyboard.press('Control+a');
  await page.getByTestId('make-compound').click();
  const clip = page.locator('[data-testid=clip]').first();
  await expect(page.locator('[data-testid=clip]')).toHaveCount(1);
  await clip.click({ position: { x: 10, y: 10 } });
  const volume = page.getByTestId('clip-inspector').getByRole('textbox', { name: 'Volume', exact: true });
  /** Export and measure the sound between 1 and 2 s. */
  const exportRms = async () => {
    await page.getByTestId('open-export').click();
    await page.getByTestId('export-dialog').getByRole('radio', { name: '720p' }).click();
    await page.getByTestId('export-start').click();
    await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 90_000 });
    const url = await page.getByTestId('export-download').getAttribute('href');
    const rms = await page.evaluate(async (href) => {
      const depPath = '/node_modules/.vite/deps/mediabunny.js';
      const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
      const input = new mb.Input({ source: new mb.BlobSource(await (await fetch(href!)).blob()), formats: mb.ALL_FORMATS });
      let sum = 0;
      let n = 0;
      for await (const s of new mb.AudioSampleSink((await input.getPrimaryAudioTrack())!).samples(1, 2)) {
        const buf = new Float32Array(s.numberOfFrames);
        s.copyTo(buf, { planeIndex: 0, format: 'f32-planar' });
        for (const v of buf) sum += v * v;
        n += buf.length;
        s.close();
      }
      return Math.sqrt(sum / n);
    }, url);
    await page.getByTestId('export-dialog').getByRole('button', { name: 'Close' }).click();
    return rms;
  };
  const full = await exportRms();
  await volume.fill('50');
  await volume.press('Enter');
  const half = await exportRms();
  console.log('[compound] rms', full, half);
  expect(full).toBeGreaterThan(0.05); // the tone inside is heard
  expect(half / full).toBeCloseTo(0.5, 1);
});
