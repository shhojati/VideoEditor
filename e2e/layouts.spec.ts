// Layouts: two clips side by side (split screen) and a circle picture-in-picture; preview = export.
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
    project: { getState: () => { history: { present: { tracks: { kind: string; clips: { id: string; start: number }[] }[] } }; undo: () => void } };
  };
  __playback: { render: (t: number) => void };
};
/** Preview pixels at fractions of the frame. */
const previewPixels = (page: Page, t: number, at: [number, number][]) =>
  page.evaluate(
    async ({ time, at }) => {
      const w = window as unknown as W;
      w.__stores.transport.getState().seek(time);
      await new Promise((r) => setTimeout(r, 600));
      w.__playback.render(time);
      const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
      const v = c.getBoundingClientRect();
      const f = document.querySelector('[data-testid=preview-frame]')!.getBoundingClientRect();
      return at.map(([fx, fy]) => {
        const x = Math.round(((f.left + f.width * fx - v.left) / v.width) * c.width);
        const y = Math.round(((f.top + f.height * fy - v.top) / v.height) * c.height);
        return Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data.slice(0, 3));
      });
    },
    { time: t, at },
  );

async function exportedPixels(page: Page, t: number, at: [number, number][]) {
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-dialog').getByRole('radio', { name: '720p' }).click();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 90_000 });
  const href = await page.getByTestId('export-download').getAttribute('href');
  const out = await page.evaluate(
    async ({ url, t, at }) => {
      const depPath = '/node_modules/.vite/deps/mediabunny.js';
      const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
      const input = new mb.Input({ source: new mb.BlobSource(await (await fetch(url!)).blob()), formats: mb.ALL_FORMATS });
      const sink = new mb.CanvasSink((await input.getPrimaryVideoTrack())!, { poolSize: 1 });
      const c = (await sink.getCanvas(t))!.canvas as OffscreenCanvas;
      const ctx = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
      return at.map(([fx, fy]) => Array.from(ctx.getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data.slice(0, 3)));
    },
    { url: href, t, at },
  );
  await page.getByTestId('export-dialog').getByRole('button', { name: 'Close' }).click();
  return out;
}

const near = (a: number[], b: number[], tol = 14) => a.every((v, k) => Math.abs(v - b[k]) < tol);

test('split screen and circle layouts; preview = export', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await importSolid(page, 'red.mp4', '#ff0000');
  await importSolid(page, 'blue.mp4', '#0000ff');
  const lane = page.locator('[data-testid=track][data-track-kind=video] [data-lane]').first();
  await page.locator('[data-testid=asset-card]', { hasText: 'red.mp4' }).dragTo(lane, { targetPosition: { x: 2, y: 20 } });
  await page.locator('[data-testid=asset-card]', { hasText: 'blue.mp4' }).dragTo(lane, { targetPosition: { x: 82, y: 20 } });
  const clips = page.locator('[data-testid=clip]');
  await expect(clips).toHaveCount(2);

  await page.getByTestId('tab-templates').click();
  await page.getByTestId('tab-layouts').click();
  await lane.click({ position: { x: 400, y: 20 } }); // empty lane: nothing selected
  await expect(page.getByTestId('layouts-selected')).toContainText('Select one or more');
  await expect(page.locator('[data-layout=split2h]')).toBeDisabled();
  await clips.nth(0).click({ position: { x: 10, y: 10 } });
  await clips.nth(1).click({ position: { x: 10, y: 10 }, modifiers: ['Shift'] });
  await expect(page.getByTestId('layouts-selected')).toContainText('2 clips selected');

  // Side by side: both at 0 s, red on the left, blue on the right, a dark gap between.
  await page.locator('[data-layout=split2h]').click();
  const starts = await page.evaluate(() =>
    (window as unknown as W).__stores.project
      .getState()
      .history.present.tracks.filter((t) => t.kind === 'video')
      .map((t) => t.clips.map((c) => c.start)),
  );
  expect(starts).toEqual([[0], [0]]);
  const splitAt: [number, number][] = [
    [0.25, 0.5],
    [0.75, 0.5],
    [0.5, 0.5],
  ];
  const split = await previewPixels(page, 1, splitAt);
  expect(near(split[0], [255, 0, 0])).toBe(true);
  expect(near(split[1], [0, 0, 255])).toBe(true);
  expect(near(split[2], [0, 0, 0])).toBe(true);
  const splitOut = await exportedPixels(page, 1, splitAt);
  console.log(JSON.stringify({ split, splitOut }));
  splitOut.slice(0, 2).forEach((px, i) => expect(near(px, split[i]), `${splitAt[i]}: ${px} vs ${split[i]}`).toBe(true));
  expect(splitOut[2][0] + splitOut[2][1] + splitOut[2][2]).toBeLessThan(90); // the thin gap (the encoder blurs its edges a little)

  // Another layout on the same clips: blue in a circle with a white border over red.
  await page.locator('[data-layout=circle]').click();
  const circleAt: [number, number][] = [
    [0.5, 0.5], // inside the circle
    [0.5 - (0.25 * 9) / 16 + 0.03, 0.27], // inside its square, outside the circle: red shows
    [0.1, 0.1], // the background clip
  ];
  const circle = await previewPixels(page, 1, circleAt);
  expect(near(circle[0], [0, 0, 255])).toBe(true);
  expect(near(circle[1], [255, 0, 0])).toBe(true);
  expect(near(circle[2], [255, 0, 0])).toBe(true);
  const circleOut = await exportedPixels(page, 1, circleAt);
  console.log(JSON.stringify({ circle, circleOut }));
  circleOut.forEach((px, i) => expect(near(px, circle[i]), `${circleAt[i]}: ${px} vs ${circle[i]}`).toBe(true));
  expect(await page.evaluate(() => (window as unknown as W).__stores.project.getState().history.present.tracks.filter((t) => t.kind === 'video').length)).toBe(2);
});
