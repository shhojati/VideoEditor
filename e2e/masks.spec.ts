// Roto masks: a mask drawn with the pen cuts a clip out; invert; moving the mask; path keyframes
// interpolate; a second, half-strength Subtract mask; the export matches the preview. A mask drawn
// around a moving object is tracked and carried along.
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

/** Object centre (video px of the 640×360 clip), angle (°) and scale at time t of the 3 s clip. */
const truth = (t: number) => {
  const p = Math.round(t * 30) / 89;
  return { x: 150 + 300 * p, y: 180, angle: 30 * p, scale: 1 + 0.3 * p };
};

/** A textured square moving right, turning 30° and growing 30 % over a dotted background. */
async function importMoving(page: Page) {
  const base64 = await page.evaluate(async () => {
    const depPath = '/node_modules/.vite/deps/mediabunny.js';
    const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
    const canvas = new OffscreenCanvas(640, 360);
    const ctx = canvas.getContext('2d')!;
    const bg = new OffscreenCanvas(640, 360);
    const b = bg.getContext('2d')!;
    let s = 5;
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647;
    b.fillStyle = '#223';
    b.fillRect(0, 0, 640, 360);
    for (let i = 0; i < 400; i++) {
      b.fillStyle = `hsl(${rand() * 360},50%,${30 + rand() * 40}%)`;
      b.beginPath();
      b.arc(rand() * 640, rand() * 360, 2 + rand() * 6, 0, 7);
      b.fill();
    }
    const obj = new OffscreenCanvas(90, 90);
    const o = obj.getContext('2d')!;
    o.fillStyle = '#eee';
    o.fillRect(0, 0, 90, 90);
    for (let y = 0; y < 6; y++)
      for (let x = 0; x < 6; x++)
        if ((x + y) % 2) {
          o.fillStyle = '#c22';
          o.fillRect(x * 15, y * 15, 15, 15);
        }
    o.fillStyle = '#126';
    o.beginPath();
    o.arc(30, 55, 12, 0, 7);
    o.fill();
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
    const video = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: mb.QUALITY_HIGH });
    output.addVideoTrack(video, { frameRate: 30 });
    await output.start();
    for (let n = 0; n < 90; n++) {
      const p = n / 89;
      ctx.drawImage(bg, 0, 0);
      ctx.save();
      ctx.translate(150 + 300 * p, 180);
      ctx.rotate((p * Math.PI) / 6);
      ctx.scale(1 + 0.3 * p, 1 + 0.3 * p);
      ctx.drawImage(obj, -45, -45);
      ctx.restore();
      await video.add(n / 30, 1 / 30);
    }
    await output.finalize();
    const bytes = new Uint8Array(output.target.buffer!);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  await page.getByTestId('media-input').setInputFiles({ name: 'moving.mp4', mimeType: 'video/mp4', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]', { hasText: 'moving.mp4' })).toBeVisible({ timeout: 60_000 });
}

type Mask = { mode: string; track?: { trackerId: string }; inverted?: boolean; path: { value: number[][]; keys?: { t: number; v: number[][] }[] } };
type W = {
  __stores: {
    project: { getState: () => { history: { present: { tracks: { clips: { masks?: Mask[]; trackers?: { id: string; samples: unknown[] }[] }[] }[] } }; undo: () => void } };
    transport: { getState: () => { seek: (t: number) => void } };
  };
  __playback: { render: (t: number) => void };
};
const trackers = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__stores.project.getState().history.present.tracks.flatMap((t) => t.clips).flatMap((c) => c.trackers ?? []));
const masks = (page: Page) =>
  page.evaluate(() => (window as unknown as W).__stores.project.getState().history.present.tracks.flatMap((t) => t.clips).find((c) => c.masks)?.masks ?? []);
const seek = (page: Page, t: number) => page.evaluate((time) => (window as unknown as W).__stores.transport.getState().seek(time), t);

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
async function drag(page: Page, from: [number, number], to: [number, number]) {
  const a = await screenAt(page, ...from);
  const b = await screenAt(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
}

test('pen mask cuts a clip out; invert, move, keyframes, subtract at 50 %; preview = export', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await importRed(page);
  await page.getByTestId('asset-add').click();
  const clip = page.locator('[data-testid=clip]', { hasText: 'red.mp4' });
  await clip.click({ position: { x: 20, y: 10 } });

  // Draw a 600×400 rectangle around the centre with the pen and close it on the first point.
  await page.getByTestId('mask-pen-start').click();
  await expect(page.getByTestId('mask-pen')).toBeVisible();
  const corners: [number, number][] = [[660, 340], [1260, 340], [1260, 740], [660, 740], [660, 340]];
  for (const c of corners) {
    const s = await screenAt(page, ...c);
    await page.mouse.click(s.x, s.y);
  }
  await expect(page.getByTestId('mask-row')).toHaveCount(1);
  await expect(page.getByTestId('mask-editor')).toBeVisible();
  await expect(clip.getByTestId('mask-badge')).toBeVisible();
  const path = (await masks(page))[0].path.value;
  expect(path).toHaveLength(4);
  // Source px (÷3), within a pixel of where the screen clicks landed.
  expect(Math.abs(path[0][0] - 220)).toBeLessThan(1.5);
  expect(Math.abs(path[2][1] - 740 / 3)).toBeLessThan(1.5);

  let px = await previewPixels(page, 0.5, [[960, 540], [300, 540]]);
  expect(red(px[0]), `inside ${px[0]}`).toBe(true);
  expect(black(px[1]), `outside ${px[1]}`).toBe(true);

  await page.getByTestId('mask-invert').check();
  px = await previewPixels(page, 0.5, [[960, 540], [300, 540]]);
  expect(black(px[0])).toBe(true);
  expect(red(px[1])).toBe(true);
  await page.getByTestId('mask-invert').uncheck();

  // Drag inside the mask: it moves (one undo step).
  await seek(page, 0.5);
  await drag(page, [960, 540], [1360, 540]);
  px = await previewPixels(page, 0.5, [[1500, 540], [700, 540]]);
  expect(red(px[0])).toBe(true);
  expect(black(px[1])).toBe(true);
  await page.evaluate(() => (window as unknown as W).__stores.project.getState().undo());

  // Animate the path: a key at 0 s, then moving it 600 px left at 2 s keys it there.
  await seek(page, 0);
  await page.getByTestId('mask-animate-path').click();
  await seek(page, 2);
  await drag(page, [960, 540], [360, 540]);
  expect((await masks(page))[0].path.keys!.map((k) => k.t)).toEqual([0, 2]);
  await expect(clip.getByTestId('mask-keyframe')).toHaveCount(2);
  // Halfway at 1 s: the rectangle spans x 360–960.
  px = await previewPixels(page, 1, [[400, 540], [1200, 540]]);
  expect(red(px[0])).toBe(true);
  expect(black(px[1])).toBe(true);
  px = await previewPixels(page, 0, [[1200, 540]]);
  expect(red(px[0])).toBe(true);

  // A centred ellipse (960×540 project px), Subtract at 50 %.
  await page.getByTestId('mask-add-ellipse').click();
  await expect(page.getByTestId('mask-row')).toHaveCount(2);
  const details = page.getByTestId('mask-details');
  await details.getByRole('combobox', { name: 'Mode' }).selectOption('subtract');
  const opacity = details.getByRole('textbox', { name: 'Mask opacity', exact: true });
  await opacity.fill('50');
  await opacity.press('Enter');
  expect((await masks(page)).map((m) => m.mode)).toEqual(['add', 'subtract']);

  const pts: [number, number][] = [[400, 540], [600, 540], [1500, 540]];
  const preview = await previewPixels(page, 1, pts);
  expect(red(preview[0]), `outside the ellipse ${preview[0]}`).toBe(true);
  expect(Math.abs(preview[1][0] - 128), `half strength ${preview[1]}`).toBeLessThan(20);
  expect(black(preview[2])).toBe(true);

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

test('a mask drawn around a moving object is tracked and carried with it', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await importMoving(page);
  await page.getByTestId('asset-add').click();
  await page.locator('[data-testid=clip]', { hasText: 'moving.mp4' }).click({ position: { x: 20, y: 10 } });

  // A pen square around the object at 0 s (video px × 3 = project px; the object is 90 px).
  await seek(page, 0);
  await page.getByTestId('mask-pen-start').click();
  const o = truth(0);
  const r = 50 * 3;
  const pts: [number, number][] = [[o.x * 3 - r, o.y * 3 - r], [o.x * 3 + r, o.y * 3 - r], [o.x * 3 + r, o.y * 3 + r], [o.x * 3 - r, o.y * 3 + r]];
  for (const c of [...pts, pts[0]]) {
    const s = await screenAt(page, ...c);
    await page.mouse.click(s.x, s.y);
  }
  await expect(page.getByTestId('mask-row')).toHaveCount(1);

  await page.getByTestId('mask-track-forward').click();
  await expect.poll(async () => (await trackers(page))[0]?.samples.length ?? 0, { timeout: 60_000 }).toBe(90);
  await expect(page.getByTestId('mask-track-forward')).toBeEnabled({ timeout: 10_000 });
  const [tracker] = await trackers(page);
  expect((await masks(page))[0].track?.trackerId).toBe(tracker.id);

  // At 2 s the object (and the mask) has moved 200 video px right: it shows there, the old place is cut.
  const at = truth(2);
  const dark = (px: number[]) => px.every((v) => v < 12);
  const [onObject, oldPlace] = await previewPixels(page, 2, [[at.x * 3, at.y * 3], [o.x * 3, o.y * 3]]);
  expect(dark(onObject), `object at 2 s ${onObject}`).toBe(false);
  expect(dark(oldPlace), `old place ${oldPlace}`).toBe(true);
});
