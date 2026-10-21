// Auto reframe with the real person detector. Opt-in (REFRAME_E2E=1): needs the model in
// public/models (scripts/fetch-models.mjs) and a photo of a person at D:/repos/.tmp/reframe-person.jpg
// (any portrait; not committed). The photo slides from left to right through a landscape clip in
// a vertical project; the camera path must follow it.
import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const PHOTO = process.env.REFRAME_PHOTO ?? 'D:/repos/.tmp/reframe-person.jpg';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
});

test('auto reframe follows a person across the frame (REFRAME_E2E=1)', async ({ page }) => {
  test.skip(!process.env.REFRAME_E2E || !existsSync(PHOTO), 'set REFRAME_E2E=1 (and provide the photo) to run');
  test.setTimeout(5 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  const photo = readFileSync(PHOTO).toString('base64');
  const base64 = await page.evaluate(async (photo) => {
    const depPath = '/node_modules/.vite/deps/mediabunny.js';
    const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
    const img = await createImageBitmap(await (await fetch(`data:image/jpeg;base64,${photo}`)).blob());
    const canvas = new OffscreenCanvas(640, 360);
    const ctx = canvas.getContext('2d')!;
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
    const video = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: mb.QUALITY_HIGH });
    output.addVideoTrack(video, { frameRate: 30 });
    await output.start();
    const h = 300;
    const w = (img.width / img.height) * h;
    for (let n = 0; n < 120; n++) {
      ctx.fillStyle = '#777';
      ctx.fillRect(0, 0, 640, 360);
      ctx.drawImage(img, 20 + (n / 119) * (640 - w - 40), 30, w, h);
      await video.add(n / 30, 1 / 30);
    }
    await output.finalize();
    const bytes = new Uint8Array(output.target.buffer!);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, photo);
  await page.getByTestId('media-input').setInputFiles({ name: 'walk.mp4', mimeType: 'video/mp4', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('asset-add').click();
  await page.locator('[data-testid=clip]').first().click({ position: { x: 20, y: 10 } });

  // Whole project: vertical, every clip reframed.
  await page.getByTestId('reframe-project').click();
  await expect(page.getByTestId('reframe-progress')).toBeVisible();
  await expect(page.getByTestId('reframe-progress')).toBeHidden({ timeout: 4 * 60_000 });
  const result = await page.evaluate(() => {
    type C = { transform: { fit?: string }; motion?: { mode: string }; trackers?: { samples: number[][] }[] };
    type P = { settings: { width: number; height: number }; tracks: { clips: C[] }[] };
    const w = window as unknown as { __stores: { project: { getState: () => { history: { present: P } } } } };
    const p = w.__stores.project.getState().history.present;
    const c = p.tracks.flatMap((t) => t.clips)[0];
    const samples = c.trackers?.[0]?.samples ?? [];
    return { size: [p.settings.width, p.settings.height], fit: c.transform.fit, mode: c.motion?.mode, xs: samples.map((s) => s[1]) };
  });
  console.log(JSON.stringify({ ...result, xs: result.xs.filter((_, i) => i % 3 === 0).map((x) => x.toFixed(2)) }));
  expect(result.size).toEqual([1080, 1920]);
  expect(result.fit).toBe('cover');
  expect(result.mode).toBe('reframe');
  // The camera starts on the left and ends on the right.
  expect(result.xs[0]).toBeLessThan(0.4);
  expect(result.xs.at(-1)!).toBeGreaterThan(0.6);
  await expect(page.getByTestId('motion-section')).toContainText('Auto reframed');
});
