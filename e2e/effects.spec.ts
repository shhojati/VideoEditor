// Effects and filters: added from their panes to a clip, as adjustment layers, dropped onto a clip,
// edited in the inspector; the preview matches the export (WebGL in the page and in the worker).
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
    for (let n = 0; n < 90; n++) {
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
    project: { getState: () => { history: { present: { tracks: { kind: string; clips: { id: string; adjustment?: boolean; effects?: { kind: string; enabled: boolean; params: Record<string, unknown> }[] }[] }[] } } } };
    transport: { getState: () => { seek: (t: number) => void } };
  };
  __playback: { render: (t: number) => void };
};
const clips = (page: Page) => page.evaluate(() => (window as unknown as W).__stores.project.getState().history.present.tracks.flatMap((t) => t.clips));

const centrePixel = (page: Page, t: number) =>
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

const seek = async (page: Page, t: number) => {
  await page.evaluate((time) => (window as unknown as W).__stores.transport.getState().seek(time), t);
};
const setField = async (scope: ReturnType<Page['getByTestId']>, name: string, value: string) => {
  const box = scope.getByRole('textbox', { name, exact: true });
  await box.fill(value);
  await box.press('Enter');
};
/** Clear the selection (focus leaves the inspector field first, or Escape stays in it). */
const deselect = async (page: Page) => {
  await page.getByTestId('timeline').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Escape');
};
/** Duration of the adjustment layer that starts at the playhead (the inspector has no Timing section). */
const setDuration = (page: Page, v: string) =>
  page.evaluate((d) => {
    type Edit = { edit: (label: string, fn: (p: { tracks: { clips: { start: number; duration: number; adjustment?: boolean }[] }[] }) => void) => void };
    const w = window as unknown as { __stores: { project: { getState: () => Edit }; transport: { getState: () => { time: number } } } };
    const time = w.__stores.transport.getState().time;
    w.__stores.project.getState().edit('test.duration', (p) => {
      for (const t of p.tracks) for (const c of t.clips) if (c.adjustment && Math.abs(c.start - time) < 1e-3) c.duration = d;
    });
  }, Number(v));

test('effects on a clip and on adjustment layers, a filter, drag onto a clip; preview = export', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await importSolid(page, 'red.mp4', '#ff0000');
  const lane = page.locator('[data-testid=track][data-track-kind=video] [data-lane]');
  await page.locator('[data-testid=asset-card]', { hasText: 'red.mp4' }).dragTo(lane, { targetPosition: { x: 2, y: 20 } });
  const red = lane.getByTestId('clip');
  await expect(red).toHaveCount(1);

  // On the selected clip: Brightness & Contrast, darker.
  await red.click();
  await page.getByTestId('tab-effects').click();
  await page.locator('[data-testid=effect-item][data-kind=brightnessContrast]').click();
  await expect(red.getByTestId('fx-badge')).toHaveText('fx');
  const card = page.getByTestId('effect-card').first();
  await setField(card, 'Brightness', '-100');
  const dark = await centrePixel(page, 0.5);
  expect(dark[0]).toBeLessThan(200);
  expect(dark[0]).toBeGreaterThan(80);

  // Nothing selected → adjustment layers: Hue +120° (red → green) for 0–1 s…
  await deselect(page);
  await seek(page, 0);
  await page.locator('[data-testid=effect-item][data-kind=hueSaturation]').click();
  await setField(page.getByTestId('effect-card').first(), 'Hue', '120');
  await setDuration(page, '1');
  // …the Mono filter for 1–2 s…
  await deselect(page);
  await seek(page, 1);
  await page.getByTestId('tab-filters').click();
  await page.locator('[data-testid=filter-item][data-preset=mono]').first().click();
  await setDuration(page, '1');
  // …and Fill (blue) for 2–3 s.
  await deselect(page);
  await seek(page, 2);
  await page.getByTestId('tab-effects').click();
  await page.locator('[data-testid=effect-item][data-kind=fill]').click();
  await page.getByTestId('effect-card').first().locator('input[type=color]').fill('#0000ff');
  await setDuration(page, '1');
  const adjustments = (await clips(page)).filter((c) => c.adjustment);
  expect(adjustments.map((c) => c.effects!.map((e) => e.kind))).toEqual([['hueSaturation'], ['look'], ['fill']]);

  const at = [0.5, 1.5, 2.5];
  const preview: number[][] = [];
  for (const t of at) preview.push(await centrePixel(page, t));
  expect(preview[0][1]).toBeGreaterThan(preview[0][0] + 40); // green
  expect(Math.max(...preview[1]) - Math.min(...preview[1])).toBeLessThan(8); // grey
  expect(preview[2][2]).toBeGreaterThan(200); // blue
  expect(preview[2][0]).toBeLessThan(30);

  // Drag Gaussian Blur from the pane onto the red clip.
  await page.locator('[data-testid=effect-item][data-kind=gaussianBlur]').dragTo(red);
  await expect(red.getByTestId('fx-badge')).toHaveText('fx 2');

  // Remove it from the inspector, then undo.
  await red.click();
  await page.getByTestId('effect-card').last().getByTestId('effect-remove').click();
  await expect(red.getByTestId('fx-badge')).toHaveText('fx');
  await page.getByTestId('timeline').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(red.getByTestId('fx-badge')).toHaveText('fx 2');

  // Export: the worker renders the same effects.
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

test('a wipe effect animates over the start of its clip; "soon" effects cannot be added', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByTestId('btn-add-shape').click();
  await page.getByTestId('add-shape-square').click();
  await page.getByTestId('tab-effects').click();
  await page.locator('[data-testid=effect-item][data-kind=linearWipe]').click();
  const card = page.getByTestId('effect-card').first();
  await card.getByRole('combobox', { name: 'Animate over the clip' }).selectOption('in');
  // Default 1 s reveal: hidden at 0, half at 0.5 s, fully there at 1 s (blue square, centre pixel).
  const at0 = await centrePixel(page, 0.02);
  const at1 = await centrePixel(page, 1.5);
  expect(at0[2]).toBeLessThan(40);
  expect(at1[2]).toBeGreaterThan(200);
  await expect(page.locator('[data-testid=effect-item][data-kind=warpStabilizer]')).toBeDisabled();
});
