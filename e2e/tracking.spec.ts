// Motion tracking: a box placed on a moving, turning, growing object is tracked in the worker; a
// shape follows it; stabilizing holds the object still; a pixelate patch follows it; the export
// matches the preview.
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
});

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

type Sample = [number, number, number, number, number];
type Clip = { id: string; shape?: { fill?: string; width: number; height: number }; adjustment?: boolean; mask?: unknown; motion?: { mode: string; position: boolean }; transform: { x: number; y: number }; trackers?: { samples: Sample[] }[] };
type W = {
  __stores: {
    project: { getState: () => { history: { present: { tracks: { clips: Clip[] }[] } }; edit: (l: string, r: (p: { tracks: { clips: Clip[] }[] }) => void) => void; undo: () => void; redo: () => void } };
    transport: { getState: () => { seek: (t: number) => void } };
  };
  __playback: { render: (t: number) => void };
};
const clips = (page: Page) => page.evaluate(() => (window as unknown as W).__stores.project.getState().history.present.tracks.flatMap((t) => t.clips));
const samples = async (page: Page) => (await clips(page)).find((c) => c.trackers)!.trackers![0].samples;

/** Preview pixel at a point of the 1920×1080 project, after drawing time t. */
const previewPixel = (page: Page, t: number, x: number, y: number) =>
  page.evaluate(
    async ({ time, x, y }) => {
      const w = window as unknown as W;
      w.__stores.transport.getState().seek(time);
      await new Promise((r) => setTimeout(r, 600));
      w.__playback.render(time);
      const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
      const v = c.getBoundingClientRect();
      const f = document.querySelector('[data-testid=preview-frame]')!.getBoundingClientRect();
      const px = Math.round(((f.left + (x / 1920) * f.width - v.left) / v.width) * c.width);
      const py = Math.round(((f.top + (y / 1080) * f.height - v.top) / v.height) * c.height);
      return Array.from(c.getContext('2d')!.getImageData(px, py, 1, 1).data.slice(0, 3));
    },
    { time: t, x, y },
  );

/** Screen point of a project point. */
async function screenAt(page: Page, x: number, y: number) {
  const f = (await page.getByTestId('preview-frame').boundingBox())!;
  return { x: f.x + (x / 1920) * f.width, y: f.y + (y / 1080) * f.height };
}

const selectVideo = (page: Page) => page.locator('[data-testid=clip]', { hasText: 'moving.mp4' }).click({ position: { x: 20, y: 10 } });

test('track a box, follow it with a shape, stabilize, pixelate; preview = export', async ({ page }) => {
  test.setTimeout(4 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await importMoving(page);
  await page.getByTestId('asset-add').click();
  await selectVideo(page);

  // A tracker box appears in the middle; drag it onto the object (video px × 3 = project px).
  await page.getByTestId('tracker-add').click();
  await expect(page.getByTestId('tracker-box')).toBeVisible();
  const from = await screenAt(page, 960, 540);
  const to = await screenAt(page, truth(0).x * 3, truth(0).y * 3);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 5 });
  await page.mouse.up();

  await page.getByTestId('track-forward').click();
  await expect(page.getByTestId('tracker-range')).toHaveText('Tracked 0.0–3.0 s', { timeout: 60_000 });
  const tracked = await samples(page);
  expect(tracked.length).toBe(90);
  for (const [t, x, y, angle, scale] of tracked) {
    const want = truth(t);
    // The box was dropped within a pixel or two of the centre (screen rounding).
    expect(Math.abs(x * 640 - want.x), `x at ${t}`).toBeLessThan(4);
    expect(Math.abs(y * 360 - want.y), `y at ${t}`).toBeLessThan(4);
    expect(Math.abs(angle - want.angle), `angle at ${t}`).toBeLessThan(0.5);
    expect(Math.abs(scale - want.scale), `scale at ${t}`).toBeLessThan(0.01);
  }
  // One undo step for the whole run.
  await page.evaluate(() => (window as unknown as W).__stores.project.getState().undo());
  expect((await samples(page)).length).toBe(1);
  await page.evaluate(() => (window as unknown as W).__stores.project.getState().redo());
  expect((await samples(page)).length).toBe(90);

  // A green square over the object at 0 s follows its position.
  await page.evaluate(() => (window as unknown as W).__stores.transport.getState().seek(0));
  await page.getByTestId('btn-add-shape').click();
  await page.getByTestId('add-shape-square').click();
  await page.evaluate(() =>
    (window as unknown as W).__stores.project.getState().edit('test', (p) => {
      const sq = p.tracks.flatMap((t) => t.clips).find((c) => c.shape)!;
      sq.shape!.fill = '#00ff00';
      sq.shape!.width = sq.shape!.height = 60;
      sq.transform.x = (450 - 960) / 1920;
      sq.transform.y = 0;
    }),
  );
  await page.getByTestId('motion-follow').selectOption({ index: 1 });
  expect((await clips(page)).find((c) => c.shape)!.motion).toMatchObject({ mode: 'follow', position: true });
  for (const t of [1, 2]) {
    const at = truth(t);
    expect(await previewPixel(page, t, at.x * 3, at.y * 3), `square on the object at ${t} s`).toEqual([0, 255, 0]);
  }

  // Stabilize: the object (and the square on it) stays where it was at 0 s; the frame moves away.
  await page.evaluate(() => (window as unknown as W).__stores.transport.getState().seek(0));
  await selectVideo(page);
  await page.getByTestId('tracker-stabilize').click();
  const box = async (t: number) => {
    await page.evaluate((time) => (window as unknown as W).__stores.transport.getState().seek(time), t);
    return (await page.getByTestId('tracker-box').locator('polygon').getAttribute('points'))!.split(/[ ,]/).map(Number);
  };
  const b0 = await box(0.5);
  const b1 = await box(2.5);
  // Same centre (scale is not stabilized by default, so the size may change).
  const centre = (b: number[]) => [(b[0] + b[4]) / 2, (b[1] + b[5]) / 2];
  centre(b1).forEach((v, i) => expect(Math.abs(v - centre(b0)[i])).toBeLessThan(1.5));
  expect(await previewPixel(page, 2.5, 450, 540)).toEqual([0, 255, 0]);
  // The right edge is now outside the moved picture.
  expect(await previewPixel(page, 2.5, 1900, 540)).toEqual([0, 0, 0]);

  // Pixelate: an adjustment layer above, masked to the object, following it.
  await page.evaluate(() => (window as unknown as W).__stores.transport.getState().seek(0));
  await selectVideo(page);
  await page.getByTestId('tracker-pixelate').click();
  const patch = (await clips(page)).find((c) => c.adjustment)!;
  expect(patch.mask).toMatchObject({ kind: 'ellipse' });
  expect(patch.motion).toMatchObject({ mode: 'follow', position: true });

  // Export: the worker renders the same stabilized picture with the square on the object.
  const preview = [await previewPixel(page, 2, 450, 540), await previewPixel(page, 2, 1900, 540)];
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
    const c = (await sink.getCanvas(2))!.canvas as OffscreenCanvas;
    const g = c.getContext('2d') as OffscreenCanvasRenderingContext2D;
    return [450, 1900].map((x) => Array.from(g.getImageData(Math.round((x / 1920) * c.width), c.height >> 1, 1, 1).data.slice(0, 3)));
  }, href);
  console.log(JSON.stringify({ preview, exported }));
  exported.forEach((px, i) => px.forEach((v, k) => expect(Math.abs(v - preview[i][k]), `${px} vs ${preview[i]}`).toBeLessThan(14)));
});
