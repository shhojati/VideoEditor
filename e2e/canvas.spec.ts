// Preview zoom/pan, shapes edited with on-canvas handles, blend modes (preview = export) and
// project files (.vproj / .vprojz).
import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

test.beforeEach(async ({ page }) => {
  // No save dialog in automation: files are offered as downloads.
  await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
});

/** A solid-colour 3 s clip, encoded in the page and imported through the media input. */
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

async function redOnTimeline(page: Page) {
  await importSolid(page, 'red.mp4', '#ff0000');
  const lane = page.locator('[data-testid=track][data-track-kind=video] [data-lane]');
  await page.locator('[data-testid=asset-card]', { hasText: 'red.mp4' }).dragTo(lane, { targetPosition: { x: 2, y: 20 } });
  await expect(lane.getByTestId('clip')).toHaveCount(1);
}

type Shape = { kind: string; width: number; height: number };
type ClipJson = { id: string; start: number; duration: number; blend?: string; shape?: Shape; transform: { x: number; y: number; rotation: number; scale: number } };
type W = {
  __stores: {
    project: { getState: () => { history: { present: { id: string; name: string; tracks: { kind: string; clips: ClipJson[] }[] }; past: { label: string }[] } } };
    transport: { getState: () => { seek: (t: number) => void } };
  };
  __playback: { render: (t: number) => void };
};
const shapes = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__stores.project.getState().history.present.tracks.flatMap((t) => t.clips.filter((c) => c.shape)));
const lastLabel = (page: Page) => page.evaluate(() => (window as unknown as W).__stores.project.getState().history.past.at(-1)?.label);

/** Pixel at the centre of the picture after drawing time t (rAF-independent). */
const centrePixel = (page: Page, t: number) =>
  page.evaluate(async (time) => {
    const w = window as unknown as W;
    w.__stores.transport.getState().seek(time);
    await new Promise((r) => setTimeout(r, 600)); // exact frames decode
    w.__playback.render(time);
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
    const v = c.getBoundingClientRect();
    const f = document.querySelector('[data-testid=preview-frame]')!.getBoundingClientRect();
    const x = Math.round(((f.left + f.width / 2 - v.left) / v.width) * c.width);
    const y = Math.round(((f.top + f.height / 2 - v.top) / v.height) * c.height);
    return Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data.slice(0, 3));
  }, t);

const near = (got: number[], want: number[], tol = 8) => expect(got.every((v, i) => Math.abs(v - want[i]) <= tol), `${got} ≈ ${want}`).toBe(true);

test('preview zoom: Ctrl+wheel at the pointer, Space+drag pans without playing, Fit restores', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  const frame = page.getByTestId('preview-frame');
  const vp = (await page.getByTestId('preview-viewport').boundingBox())!;
  const fit = (await frame.boundingBox())!;
  await expect(page.getByTestId('preview-zoom')).toHaveValue('fit');

  // Zoom in at a point left of centre: that point stays under the pointer.
  const px = vp.x + vp.width * 0.35;
  const py = vp.y + vp.height * 0.5;
  const rel = (px - fit.x) / fit.width;
  await page.mouse.move(px, py);
  await page.keyboard.down('Control');
  await page.mouse.wheel(0, -400);
  await page.keyboard.up('Control');
  await expect.poll(async () => (await frame.boundingBox())!.width).toBeGreaterThan(fit.width * 1.5);
  const zoomed = (await frame.boundingBox())!;
  expect(Math.abs(zoomed.x + rel * zoomed.width - px)).toBeLessThan(2);
  await expect(page.getByTestId('preview-zoom')).not.toHaveValue('fit');

  // Space + drag pans; releasing Space after a drag does not start playback.
  await page.keyboard.down('Space');
  await page.mouse.down();
  await page.mouse.move(px + 80, py + 30, { steps: 4 });
  await page.mouse.up();
  await page.keyboard.up('Space');
  const panned = (await frame.boundingBox())!;
  expect(Math.abs(panned.x - zoomed.x - 80)).toBeLessThan(2);
  expect(await page.getByTestId('play').getAttribute('aria-label')).toBe('Play');

  // Presets and Fit.
  await page.getByTestId('preview-zoom').selectOption('1');
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(1920);
  await page.getByTestId('preview-zoom').selectOption('fit');
  await expect.poll(async () => Math.round((await frame.boundingBox())!.width)).toBe(Math.round(fit.width));
});

test('shapes: add, move/resize/rotate on the canvas (one undo step each), blend modes match in export', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await redOnTimeline(page);

  await page.getByTestId('btn-add-shape').click();
  await page.getByTestId('add-shape-square').click();
  const box = page.getByTestId('selection-box');
  await expect(box).toHaveCount(1);
  await expect(page.locator('[data-testid=track][data-track-kind=text] [data-testid=clip]')).toContainText('Square');
  const [sq] = await shapes(page);
  expect(sq.shape).toMatchObject({ kind: 'square', width: 300, height: 300 });

  // Move: drag the body.
  const b0 = (await box.boundingBox())!;
  await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
  await page.mouse.down();
  await page.mouse.move(b0.x + b0.width / 2 + 60, b0.y + b0.height / 2 + 40, { steps: 6 });
  await page.mouse.up();
  let [s] = await shapes(page);
  expect(s.transform.x).toBeGreaterThan(0.03);
  expect(s.transform.y).toBeGreaterThan(0.03);
  expect(await lastLabel(page)).toBe('ops.canvasMove');

  // Resize from the bottom-right corner: a square stays square.
  const corner = (await page.locator('[data-handle="c:1:1"]').boundingBox())!;
  await page.mouse.move(corner.x + corner.width / 2, corner.y + corner.height / 2);
  await page.mouse.down();
  await page.mouse.move(corner.x + 50, corner.y + 20, { steps: 6 });
  await page.mouse.up();
  [s] = await shapes(page);
  expect(s.shape!.width).toBeGreaterThan(330);
  expect(s.shape!.height).toBe(s.shape!.width);
  expect(await lastLabel(page)).toBe('ops.canvasResize');

  // Rotate with Shift: snaps to 15° steps.
  const knob = (await page.locator('[data-handle="r"]').boundingBox())!;
  const b1 = (await box.boundingBox())!;
  await page.mouse.move(knob.x + knob.width / 2, knob.y + knob.height / 2);
  await page.mouse.down();
  await page.keyboard.down('Shift');
  await page.mouse.move(b1.x + b1.width + 80, b1.y + b1.height / 2 - 20, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up('Shift');
  [s] = await shapes(page);
  expect(Math.abs(s.transform.rotation)).toBeGreaterThan(30);
  expect(s.transform.rotation % 15).toBeCloseTo(0);

  // Three gestures = three undo steps back to the original placement.
  await page.getByTestId('timeline').click({ position: { x: 5, y: 5 } });
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+z');
  [s] = await shapes(page);
  expect(s.transform).toMatchObject({ x: 0, y: 0, rotation: 0 });
  expect(s.shape).toMatchObject({ width: 300, height: 300 });

  // Blend modes: blue square over red, 0.75 s each: multiply, darker color, screen, subtract.
  await page.locator('[data-testid=track][data-track-kind=text] [data-testid=clip]').click();
  await page.getByTestId('blend-mode').selectOption('multiply');
  await expect(page.getByTestId('blend-badge')).toHaveText('◐ Multiply');
  await page.evaluate(() => {
    type E = { edit: (l: string, r: (p: { tracks: { kind: string; clips: Record<string, unknown>[] }[] }) => void) => void };
    (window as unknown as { __stores: { project: { getState: () => E } } }).__stores.project.getState().edit('test', (p) => {
      const track = p.tracks.find((t) => t.kind === 'text')!;
      const first = track.clips[0];
      first.duration = 0.75;
      const copy = (start: number, blend: string) => ({ ...JSON.parse(JSON.stringify(first)), id: crypto.randomUUID(), start, blend });
      track.clips.push(copy(0.75, 'darkerColor'), copy(1.5, 'screen'), copy(2.25, 'subtract'));
    });
  });
  const blue = [37, 99, 235];
  const at = [0.375, 1.125, 1.875, 2.625];
  const preview: number[][] = [];
  for (const t of at) preview.push(await centrePixel(page, t));
  near(preview[0], [blue[0], 0, 0]); // multiply: red × blue
  near(preview[1], [255, 0, 0]); // darker colour: red has the lower luma, so red stays
  near(preview[2], [255, blue[1], blue[2]]); // screen
  near(preview[3], [255 - blue[0], 0, 0]); // subtract (per-pixel lookup table)

  await page.getByTestId('open-export').click();
  await page.getByTestId('export-dialog').getByRole('radio', { name: '720p' }).click();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 90_000 });
  const href = await page.getByTestId('export-download').getAttribute('href');
  const exported = await page.evaluate(async ({ url, at }) => {
    const depPath = '/node_modules/.vite/deps/mediabunny.js';
    const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
    const blob = await (await fetch(url!)).blob();
    const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    const sink = new mb.CanvasSink((await input.getPrimaryVideoTrack())!, { poolSize: 1 });
    const px = async (t: number) => {
      const c = (await sink.getCanvas(t))!.canvas as OffscreenCanvas;
      return Array.from((c.getContext('2d') as OffscreenCanvasRenderingContext2D).getImageData(c.width >> 1, c.height >> 1, 1, 1).data.slice(0, 3));
    };
    const out: number[][] = [];
    for (const t of at) out.push(await px(t));
    return out;
  }, { url: href, at });
  console.log(JSON.stringify({ preview, exported }));
  exported.forEach((px, i) => near(px, preview[i], 10));
});

test('project files: .vproj links media, .vprojz carries it; both open as new copies', async ({ page }) => {
  test.setTimeout(2 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await redOnTimeline(page);
  await page.getByTestId('btn-add-shape').click();
  await page.getByTestId('add-shape-star').click();
  await page.getByTestId('blend-mode').selectOption('screen');
  const original = await page.evaluate(() => (window as unknown as W).__stores.project.getState().history.present);

  const download = async (testId: string) => {
    await page.getByRole('button', { name: /Projects/ }).click();
    const [d] = await Promise.all([page.waitForEvent('download'), page.getByTestId(testId).click()]);
    return { name: d.suggestedFilename(), path: (await d.path())! };
  };
  const json = await download('save-project-file');
  expect(json.name).toMatch(/\.vproj$/);
  const doc = JSON.parse(readFileSync(json.path, 'utf8'));
  expect(doc).toMatchObject({ format: 'video-editor-project', formatVersion: 1 });
  expect(doc.project.tracks).toEqual(original.tracks);

  const bundle = await download('save-project-bundle');
  expect(bundle.name).toMatch(/\.vprojz$/);
  const bundleBytes = readFileSync(bundle.path);
  expect(bundleBytes.subarray(0, 4).toString('hex')).toBe('504b0304');

  // Forget the media file, as on another computer.
  const dropMedia = () =>
    page.evaluate(async () => {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry('media', { recursive: true });
    });
  await dropMedia();

  // The bundle restores it.
  await page.getByTestId('project-file-input').setInputFiles({ name: bundle.name, mimeType: 'application/octet-stream', buffer: bundleBytes });
  await expect.poll(() => page.evaluate(() => (window as unknown as W).__stores.project.getState().history.present.id)).not.toBe(original.id);
  let opened = await page.evaluate(() => (window as unknown as W).__stores.project.getState().history.present);
  expect(opened.name).toBe(original.name);
  expect(opened.tracks).toEqual(original.tracks);
  await expect(page.locator('[data-testid=asset-card][data-status=ready]', { hasText: 'red.mp4' })).toBeVisible({ timeout: 30_000 });
  near(await centrePixel(page, 1), [255, 204, 21], 12); // yellow star (#facc15) screened over red

  // The plain file links media: without the file here it opens with the asset missing.
  await dropMedia();
  await page.getByTestId('project-file-input').setInputFiles(json.path);
  await expect(page.getByRole('alert')).toContainText('1 media file(s) are not on this device');
  opened = await page.evaluate(() => (window as unknown as W).__stores.project.getState().history.present);
  expect(opened.tracks).toEqual(original.tracks);
  await expect(page.locator('[data-testid=asset-card][data-status=missing]', { hasText: 'red.mp4' })).toBeVisible();

  // Broken files are refused with a reason.
  await page.getByTestId('project-file-input').setInputFiles({ name: 'x.vproj', mimeType: 'application/json', buffer: Buffer.from('{"hi":1}') });
  await expect(page.getByRole('alert').last()).toContainText("can't be opened: not a project file");
});
