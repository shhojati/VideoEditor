// Colour tools: a built-in LUT from the Filters pane, an imported .cube in Apply LUT, Color Wheels,
// the scopes, and the export matching the preview.
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
  __stores: { transport: { getState: () => { seek: (t: number) => void } } };
  __playback: { render: (t: number) => void };
};
const centrePixel = (page: Page, t = 1) =>
  page.evaluate(async (time) => {
    const w = window as unknown as W;
    w.__stores.transport.getState().seek(time);
    await new Promise((r) => setTimeout(r, 500));
    w.__playback.render(time);
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
    const v = c.getBoundingClientRect();
    const f = document.querySelector('[data-testid=preview-frame]')!.getBoundingClientRect();
    const x = Math.round(((f.left + f.width / 2 - v.left) / v.width) * c.width);
    const y = Math.round(((f.top + f.height / 2 - v.top) / v.height) * c.height);
    return Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data.slice(0, 3));
  }, t);
const near = (px: number[], want: number[], tol = 12) => px.every((v, i) => Math.abs(v - want[i]) <= tol);

/** A 2-point .cube that inverts colours. */
const INVERT = ['TITLE "Invert"', 'LUT_3D_SIZE 2', ...[0, 1].flatMap((b) => [0, 1].flatMap((g) => [0, 1].map((r) => `${1 - r} ${1 - g} ${1 - b}`)))].join('\n');

test('LUT pack, imported .cube, color wheels and scopes; preview = export', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await importSolid(page, 'red.mp4', '#ff0000');
  await page.getByTestId('asset-add').click();
  const clip = page.locator('[data-testid=clip]').first();
  await clip.click({ position: { x: 20, y: 10 } });

  // Built-in Sepia from the Filters pane: red → (100, 89, 69).
  await page.getByTestId('tab-filters').click();
  await page.locator('[data-testid=lut-item][data-lut=sepia]').click();
  const sepia = await centrePixel(page);
  expect(near(sepia, [100, 89, 69]), String(sepia)).toBe(true);
  await page.getByTestId('timeline').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');

  // Apply LUT with an imported .cube that inverts: red → cyan.
  await clip.click({ position: { x: 20, y: 10 } });
  await page.getByTestId('tab-effects').click();
  await page.locator('[data-testid=effect-item][data-kind=lut3d]').click();
  await page.getByTestId('lut-input').setInputFiles({ name: 'invert.cube', mimeType: 'text/plain', buffer: Buffer.from(INVERT) });
  await expect(page.getByTestId('lut-select')).toHaveValue(/.+/);
  const inverted = await centrePixel(page);
  expect(near(inverted, [0, 255, 255]), String(inverted)).toBe(true);

  // Color Wheels after it, saturation 0: grey.
  await page.locator('[data-testid=effect-item][data-kind=colorWheels]').click();
  const wheels = page.locator('[data-testid=effect-card][data-kind=colorWheels]');
  await expect(wheels.getByTestId('color-wheel')).toHaveCount(3);
  const sat = wheels.getByRole('textbox', { name: 'Saturation', exact: true });
  await sat.fill('0');
  await sat.press('Enter');
  const grey = await centrePixel(page);
  expect(Math.max(...grey) - Math.min(...grey), String(grey)).toBeLessThan(6);

  // Scopes show up and draw.
  await page.getByTestId('scopes-toggle').click();
  await expect(page.getByTestId('scopes')).toBeVisible();
  await expect
    .poll(() => page.getByTestId('vectorscope').evaluate((c: HTMLCanvasElement) => c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data.some((v, i) => i % 4 !== 3 && v > 40)))
    .toBe(true);

  await page.getByTestId('open-export').click();
  await page.getByTestId('export-dialog').getByRole('radio', { name: '720p' }).click();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 90_000 });
  const href = await page.getByTestId('export-download').getAttribute('href');
  const exported = await page.evaluate(async (url) => {
    const depPath = '/node_modules/.vite/deps/mediabunny.js';
    const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
    const input = new mb.Input({ source: new mb.BlobSource(await (await fetch(url!)).blob()), formats: mb.ALL_FORMATS });
    const sink = new mb.CanvasSink((await input.getPrimaryVideoTrack())!, { poolSize: 1 });
    const c = (await sink.getCanvas(1))!.canvas as OffscreenCanvas;
    return Array.from((c.getContext('2d') as OffscreenCanvasRenderingContext2D).getImageData(c.width >> 1, c.height >> 1, 1, 1).data.slice(0, 3));
  }, href);
  console.log(JSON.stringify({ sepia, inverted, grey, exported }));
  expect(near(exported, grey, 13), `${exported} vs ${grey}`).toBe(true);
});
