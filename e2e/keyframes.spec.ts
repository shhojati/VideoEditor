// Keyframes, InShot style: ◆ at 0 s, a canvas move at 2 s adds a keyframe there, the clip glides in
// between (linear ease here), an opacity change lands in the keyframe under the playhead, the
// timeline diamonds jump the playhead and retime keyframes, K toggles one, and the export matches
// the preview.
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
});

/** A 3 s red 640×360 clip (shown ×3 in the 1920×1080 project). */
async function importRed(page: Page) {
  const base64 = await page.evaluate(async () => {
    const depPath = '/node_modules/.vite/deps/mediabunny.js';
    const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
    const canvas = new OffscreenCanvas(640, 360);
    const ctx = canvas.getContext('2d')!;
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
    const video = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: mb.QUALITY_HIGH });
    output.addVideoTrack(video, { frameRate: 30 });
    await output.start();
    for (let n = 0; n < 90; n++) {
      ctx.fillStyle = '#ff0000';
      ctx.fillRect(0, 0, 640, 360);
      await video.add(n / 30, 1 / 30);
    }
    await output.finalize();
    const bytes = new Uint8Array(output.target.buffer!);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  await page.getByTestId('media-input').setInputFiles({ name: 'red.mp4', mimeType: 'video/mp4', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]', { hasText: 'red.mp4' })).toBeVisible({ timeout: 60_000 });
}

type Key = { t: number; ease?: string; v: Record<string, number> };
type W = {
  __stores: {
    project: { getState: () => { history: { present: { tracks: { clips: { keyframes?: Key[] }[] }[] } }; undo: () => void } };
    transport: { getState: () => { time: number; seek: (t: number) => void } };
  };
  __playback: { render: (t: number) => void };
};
const keyframes = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__stores.project.getState().history.present.tracks.flatMap((t) => t.clips).find((c) => c.keyframes)?.keyframes ?? []);
const seek = (page: Page, t: number) => page.evaluate((time) => (window as unknown as W).__stores.transport.getState().seek(time), t);
const playhead = (page: Page) => page.evaluate(() => (window as unknown as W).__stores.transport.getState().time);

/** Preview pixels at points of the 1920×1080 project, after drawing time t. */
const previewPixels = (page: Page, t: number, pts: [number, number][]) =>
  page.evaluate(
    async ({ time, pts }) => {
      const w = window as unknown as W;
      w.__stores.transport.getState().seek(time);
      await new Promise((r) => setTimeout(r, 600));
      w.__playback.render(time);
      const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
      const v = c.getBoundingClientRect();
      const f = document.querySelector('[data-testid=preview-frame]')!.getBoundingClientRect();
      return pts.map(([x, y]) => {
        const px = Math.round(((f.left + (x / 1920) * f.width - v.left) / v.width) * c.width);
        const py = Math.round(((f.top + (y / 1080) * f.height - v.top) / v.height) * c.height);
        return Array.from(c.getContext('2d')!.getImageData(px, py, 1, 1).data.slice(0, 3));
      });
    },
    { time: t, pts },
  );
const red = (px: number[]) => px[0] > 200 && px[1] < 40;
const black = (px: number[]) => px[0] < 30 && px[1] < 30 && px[2] < 30;

async function screenAt(page: Page, x: number, y: number) {
  const f = (await page.getByTestId('preview-frame').boundingBox())!;
  return { x: f.x + (x / 1920) * f.width, y: f.y + (y / 1080) * f.height };
}

async function setField(page: Page, name: string, value: string) {
  const box = page.getByTestId('clip-inspector').getByRole('textbox', { name, exact: true });
  await box.fill(value);
  await box.press('Enter');
}

test('keyframes: ◆ then a move elsewhere animates the clip; opacity keys; diamonds; preview = export', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await importRed(page);
  await page.getByTestId('asset-add').click();
  const clip = page.locator('[data-testid=clip]', { hasText: 'red.mp4' });
  await clip.click({ position: { x: 20, y: 10 } });

  // A 480×270 red box in the centre.
  await setField(page, 'Scale', '25');
  await seek(page, 0);
  const button = page.getByTestId('btn-keyframe');
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  expect((await keyframes(page)).map((k) => k.t)).toEqual([0]);

  // At 2 s, drag the box 600 px right on the canvas: a second keyframe appears there by itself.
  await seek(page, 2);
  await expect(button).toHaveAttribute('aria-pressed', 'false');
  const a = await screenAt(page, 960, 540);
  const b = await screenAt(page, 1560, 540);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  let keys = await keyframes(page);
  expect(keys.map((k) => k.t)).toEqual([0, 2]);
  expect(keys[1].v.x).toBeCloseTo(600 / 1920, 2);
  await expect(clip.getByTestId('clip-keyframe')).toHaveCount(2);
  await expect(clip.getByTestId('clip-keyframe').nth(1)).toHaveAttribute('data-active', 'true');

  // Opacity 50 % at 2 s goes into that keyframe.
  await setField(page, 'Opacity', '50');
  keys = await keyframes(page);
  expect(keys).toHaveLength(2);
  expect(keys[1].v.opacity).toBeCloseTo(0.5);

  // The first diamond puts the playhead back on 0 s; make that keyframe linear.
  await clip.getByTestId('clip-keyframe').first().click();
  expect(await playhead(page)).toBeCloseTo(0, 2);
  await page.getByTestId('keyframes-section').getByRole('combobox').selectOption('linear');
  expect((await keyframes(page))[0].ease).toBe('linear');

  // At 1 s the box is halfway (centre x 1260, spanning 1020–1500) at 75 % opacity.
  const pts: [number, number][] = [[1260, 540], [960, 540], [1700, 540]];
  const preview = await previewPixels(page, 1, pts);
  expect(Math.abs(preview[0][0] - 191), `halfway, 75 % ${preview[0]}`).toBeLessThan(12);
  expect(black(preview[1]), `left behind ${preview[1]}`).toBe(true);
  expect(black(preview[2]), `not there yet ${preview[2]}`).toBe(true);
  const start = await previewPixels(page, 0, [[960, 540], [1260, 540]]);
  expect(red(start[0])).toBe(true);
  expect(black(start[1])).toBe(true);

  // Dragging the second diamond retimes it (whole frames), in one undo step.
  const second = clip.getByTestId('clip-keyframe').nth(1);
  const box = (await second.boundingBox())!;
  const pps = await page.evaluate(() => {
    const c = document.querySelector('[data-testid=clip]')!;
    return c.getBoundingClientRect().width / Number(c.getAttribute('data-duration'));
  });
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 0.5 * pps, box.y + box.height / 2, { steps: 5 });
  await page.mouse.up();
  expect((await keyframes(page))[1].t).toBeCloseTo(2.5, 1);
  await page.evaluate(() => (window as unknown as W).__stores.project.getState().undo());
  expect((await keyframes(page))[1].t).toBeCloseTo(2, 3);

  // K adds a keyframe on the selected clip at the playhead, and removes it again.
  await seek(page, 1);
  await page.keyboard.press('k');
  expect((await keyframes(page)).map((k) => k.t)).toEqual([0, 1, 2]);
  await page.keyboard.press('k');
  expect((await keyframes(page)).map((k) => k.t)).toEqual([0, 2]);

  await page.getByTestId('open-export').click();
  await page.getByTestId('export-dialog').getByRole('radio', { name: '720p' }).click();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 90_000 });
  const href = await page.getByTestId('export-download').getAttribute('href');
  const exported = await page.evaluate(
    async ({ url, pts }) => {
      const depPath = '/node_modules/.vite/deps/mediabunny.js';
      const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
      const input = new mb.Input({ source: new mb.BlobSource(await (await fetch(url!)).blob()), formats: mb.ALL_FORMATS });
      const sink = new mb.CanvasSink((await input.getPrimaryVideoTrack())!, { poolSize: 1 });
      const c = (await sink.getCanvas(1))!.canvas as OffscreenCanvas;
      const g = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
      return pts.map(([x, y]) => Array.from(g.getImageData(Math.round((x / 1920) * c.width), Math.round((y / 1080) * c.height), 1, 1).data.slice(0, 3)));
    },
    { url: href, pts },
  );
  console.log(JSON.stringify({ preview, exported }));
  exported.forEach((p, i) => p.forEach((v, k) => expect(Math.abs(v - preview[i][k]), `${pts[i]}: ${p} vs ${preview[i]}`).toBeLessThan(14)));
});
