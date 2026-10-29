// Keylight: pick the key colour from the clip's frame, key a green screen over the clip below,
// check the matte view, and match the export.
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
});

/** 2 s video: a solid background, optionally with a red square in the middle 40%. */
async function importVideo(page: Page, name: string, background: string, square: boolean) {
  const base64 = await page.evaluate(
    async ({ background, square }) => {
      const depPath = '/node_modules/.vite/deps/mediabunny.js';
      const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
      const canvas = new OffscreenCanvas(640, 360);
      const ctx = canvas.getContext('2d')!;
      const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
      const video = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: mb.QUALITY_HIGH });
      output.addVideoTrack(video, { frameRate: 30 });
      await output.start();
      for (let n = 0; n < 60; n++) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, 640, 360);
        if (square) {
          ctx.fillStyle = '#ff0000';
          ctx.fillRect(192, 108, 256, 144);
        }
        await video.add(n / 30, 1 / 30);
      }
      await output.finalize();
      const bytes = new Uint8Array(output.target.buffer!);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    { background, square },
  );
  await page.getByTestId('media-input').setInputFiles({ name, mimeType: 'video/mp4', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]', { hasText: name })).toBeVisible({ timeout: 60_000 });
}

type W = {
  __stores: { transport: { getState: () => { seek: (t: number) => void } } };
  __playback: { render: (t: number) => void };
};
/** Preview pixel at a point of the frame (fractions of its width and height). */
const pixel = (page: Page, t: number, fx: number, fy: number) =>
  page.evaluate(
    async ({ t, fx, fy }) => {
      const w = window as unknown as W;
      w.__stores.transport.getState().seek(t);
      await new Promise((r) => setTimeout(r, 600));
      w.__playback.render(t);
      const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
      const v = c.getBoundingClientRect();
      const f = document.querySelector('[data-testid=preview-frame]')!.getBoundingClientRect();
      const x = Math.round(((f.left + f.width * fx - v.left) / v.width) * c.width);
      const y = Math.round(((f.top + f.height * fy - v.top) / v.height) * c.height);
      return Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data.slice(0, 3));
    },
    { t, fx, fy },
  );

test('keylight keys a green screen; matte view; preview = export', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await importVideo(page, 'blue.mp4', '#0000ff', false);
  await importVideo(page, 'screen.mp4', '#00ff00', true);
  // Blue on the bottom track, the green screen on a new track above it.
  await page.evaluate(async () => {
    const lib = '/src/features/timeline/interactions.ts';
    const { placeAssetAt } = await import(/* @vite-ignore */ lib);
    type P = { assets: Record<string, { id: string; name: string }>; tracks: { id: string; kind: string }[] };
    const w = window as unknown as { __stores: { project: { getState: () => { history: { present: P } } } } };
    const get = () => w.__stores.project.getState().history.present;
    const id = (name: string) => Object.values(get().assets).find((a) => a.name === name)!.id;
    placeAssetAt(id('blue.mp4'), get().tracks.find((t) => t.kind === 'video')!.id, 0);
    placeAssetAt(id('screen.mp4'), null, 0);
  });
  await page.locator('[data-testid=clip]', { hasText: 'screen.mp4' }).click({ position: { x: 20, y: 10 } });
  await page.getByTestId('tab-fx').click();
  await page.getByTestId('tab-effects').click();
  await page.locator('[data-testid=effect-item][data-kind=keylight]').click();
  const card = page.locator('[data-testid=effect-card][data-kind=keylight]');
  await expect(card).toBeVisible();

  // Pick the key colour from the clip's own frame (a corner: green).
  await card.getByTestId('pick-color').click();
  const picker = card.getByTestId('frame-picker');
  await expect(picker).toHaveAttribute('data-ready', 'true');
  await picker.click({ position: { x: 6, y: 6 } });
  const key = await page.evaluate(() => {
    type C = { effects?: { kind: string; params: Record<string, unknown> }[] };
    const w = window as unknown as { __stores: { project: { getState: () => { history: { present: { tracks: { clips: C[] }[] } } } } } };
    return w.__stores.project.getState().history.present.tracks.flatMap((t) => t.clips).flatMap((c) => c.effects ?? [])[0].params.keyColor as string;
  });
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(key.slice(i, i + 2), 16));
  expect(g).toBeGreaterThan(220);
  expect(r + b).toBeLessThan(60);

  const at: [number, number][] = [
    [0.5, 0.5],
    [0.1, 0.1],
  ];
  const preview: number[][] = [];
  for (const [fx, fy] of at) preview.push(await pixel(page, 1, fx, fy));
  expect(preview[0][0]).toBeGreaterThan(200); // the red square stays
  expect(preview[1][2]).toBeGreaterThan(200); // blue shows through the keyed green
  expect(preview[1][1]).toBeLessThan(40);

  // Matte view: kept area white, keyed area black.
  await card.getByRole('combobox', { name: 'View' }).selectOption('matte');
  expect(Math.min(...(await pixel(page, 1, 0.5, 0.5)))).toBeGreaterThan(220);
  expect(Math.max(...(await pixel(page, 1, 0.1, 0.1)))).toBeLessThan(30);
  await card.getByRole('combobox', { name: 'View' }).selectOption('final');

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
      const c = (await sink.getCanvas(1))!.canvas as OffscreenCanvas;
      const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
      return at.map(([fx, fy]) => Array.from(ctx.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data.slice(0, 3)));
    },
    { url: href, at },
  );
  console.log(JSON.stringify({ key, preview, exported }));
  exported.forEach((px, i) => px.forEach((v, k) => expect(Math.abs(v - preview[i][k]), `point ${i} channel ${k}: ${px} vs ${preview[i]}`).toBeLessThan(14)));
});
