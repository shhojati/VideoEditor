// Library panes (Stickers, Sound effects, Overlays) against a mocked server folder listing in the
// nginx autoindex JSON format: categories, click-to-add, drag-to-add, animated GIF playback in
// preview and export, overlays screened, and the "not set up" message.
import { expect, test, type Page, type Route } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
});

/**
 * A w×h animated GIF, one solid colour per frame (delay in 1/100 s). Uses 8-bit LZW codes with a
 * clear code every 120 pixels, so every code is one byte and no dictionary handling is needed.
 */
function gif(w: number, h: number, colors: [number, number, number][], delay: number) {
  const out: number[] = [];
  const u16 = (v: number) => out.push(v & 0xff, v >> 8);
  out.push(...Buffer.from('GIF89a'));
  u16(w);
  u16(h);
  out.push(0xf6, 0, 0); // global colour table, 128 entries
  for (let i = 0; i < 128; i++) out.push(...(colors[i] ?? [0, 0, 0]));
  out.push(0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0); // loop forever
  colors.forEach((_, index) => {
    out.push(0x21, 0xf9, 4, 0, delay & 0xff, delay >> 8, 0, 0); // frame delay
    out.push(0x2c);
    u16(0);
    u16(0);
    u16(w);
    u16(h);
    out.push(0, 7); // no local table; LZW minimum code size 7 → 8-bit codes
    const codes: number[] = [];
    for (let p = 0; p < w * h; p++) {
      if (p % 120 === 0) codes.push(128); // clear
      codes.push(index);
    }
    codes.push(129); // end
    for (let i = 0; i < codes.length; i += 255) {
      const block = codes.slice(i, i + 255);
      out.push(block.length, ...block);
    }
    out.push(0);
  });
  out.push(0x3b);
  return Buffer.from(out);
}

/** Encodes a solid-colour MP4 (video) or a tone in OGG/Opus (audio) inside the page. */
async function encode(page: Page, kind: 'video' | 'audio', color = '#ffffff') {
  const b64 = await page.evaluate(
    async ({ kind, color }) => {
      const depPath = '/node_modules/.vite/deps/mediabunny.js';
      const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
      const target = new mb.BufferTarget();
      if (kind === 'video') {
        const canvas = new OffscreenCanvas(320, 180);
        const ctx = canvas.getContext('2d')!;
        const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target });
        const src = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: mb.QUALITY_HIGH });
        output.addVideoTrack(src, { frameRate: 30 });
        await output.start();
        for (let n = 0; n < 60; n++) {
          ctx.fillStyle = color;
          ctx.fillRect(0, 0, 320, 180);
          await src.add(n / 30, 1 / 30);
        }
        await output.finalize();
      } else {
        const output = new mb.Output({ format: new mb.OggOutputFormat(), target });
        const src = new mb.AudioBufferSource({ codec: 'opus', bitrate: 64_000 });
        output.addAudioTrack(src);
        await output.start();
        const buf = new AudioBuffer({ length: 48_000, numberOfChannels: 1, sampleRate: 48_000 });
        buf.getChannelData(0).forEach((_, i, d) => (d[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / 48_000)));
        await src.add(buf);
        await output.finalize();
      }
      const bytes = new Uint8Array(target.buffer!);
      let bin = '';
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(bin);
    },
    { kind, color },
  );
  return Buffer.from(b64, 'base64');
}

/** Serve a fake /library tree: { 'stickers/': listing, 'stickers/a.gif': bytes, ... }. */
async function serveLibrary(page: Page, files: Record<string, Buffer>, delayMs = 0) {
  const tree = new Map<string, Buffer>(Object.entries(files));
  await page.route((url) => url.pathname.startsWith('/library/'), async (route: Route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname.slice('/library/'.length));
    if (path.endsWith('/')) {
      const children = new Map<string, { name: string; type: string; size?: number }>();
      for (const [p, b] of tree) {
        if (!p.startsWith(path)) continue;
        const [first, ...rest] = p.slice(path.length).split('/');
        children.set(first, rest.length ? { name: first, type: 'directory' } : { name: first, type: 'file', size: b.length });
      }
      if (!children.size) return route.fulfill({ status: 404 });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify([...children.values()]) });
    }
    const body = tree.get(path);
    if (!body) return route.fulfill({ status: 404 });
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    return route.fulfill({ body, headers: { 'Cross-Origin-Resource-Policy': 'same-origin' } });
  });
}

type ClipJson = { assetId?: string; start: number; blend?: string; transform: { scale: number } };
type W = {
  __stores: {
    project: { getState: () => { history: { present: { assets: Record<string, { name: string; kind: string; library?: { kind: string; path: string } }>; tracks: { kind: string; clips: ClipJson[] }[] } } } };
    transport: { getState: () => { seek: (t: number) => void } };
  };
  __playback: { render: (t: number) => void };
};
const present = (page: Page) => page.evaluate(() => (window as unknown as W).__stores.project.getState().history.present);

const centrePixel = (page: Page, t: number) =>
  page.evaluate(async (time) => {
    const w = window as unknown as W;
    w.__stores.transport.getState().seek(time);
    await new Promise((r) => setTimeout(r, 400));
    w.__playback.render(time);
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
    const v = c.getBoundingClientRect();
    const f = document.querySelector('[data-testid=preview-frame]')!.getBoundingClientRect();
    const x = Math.round(((f.left + f.width / 2 - v.left) / v.width) * c.width);
    const y = Math.round(((f.top + f.height / 2 - v.top) / v.height) * c.height);
    return Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data.slice(0, 3));
  }, t);

test('stickers (animated GIF), sound effects and overlays from the server library', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  const red: [number, number, number] = [255, 0, 0];
  const green: [number, number, number] = [0, 255, 0];
  await serveLibrary(page, {
    'stickers/blink.gif': gif(40, 40, [red, green], 50),
    'stickers/emoji/smile face.gif': gif(8, 8, [[255, 255, 0]], 100),
    'stickers/notes.txt': Buffer.from('ignored: not an image'),
    'sounds/whoosh.ogg': await encode(page, 'audio'),
    'overlays/light leak.mp4': await encode(page, 'video', '#4040ff'),
  }, 300);

  // Stickers: files at the top level plus a category; other file types are not listed.
  await page.getByTestId('tab-assets').click();
  await page.getByTestId('tab-stickers').click();
  const stickers = page.getByTestId('library-stickers');
  await expect(stickers.getByTestId('library-item')).toHaveCount(2);
  await expect(stickers.getByRole('heading', { name: 'emoji' })).toBeVisible();
  await expect(stickers.getByTestId('library-item').last()).toContainText('smile face');

  // Click adds at the playhead: a small sticker on a video track, remembered as a library asset.
  await stickers.locator('[data-testid=library-item][data-path="blink.gif"]').click();
  await expect.poll(async () => (await present(page)).tracks.flatMap((t) => t.clips).length).toBe(1);
  let p = await present(page);
  const sticker = p.tracks.find((t) => t.kind === 'video')!.clips[0];
  expect(sticker.transform.scale).toBe(0.35);
  expect(p.assets[sticker.assetId!]).toMatchObject({ kind: 'image', name: 'blink', library: { kind: 'stickers', path: 'blink.gif' } });

  // The GIF animates: red for the first half second, green for the next, then loops.
  const frames = [await centrePixel(page, 0.25), await centrePixel(page, 0.75), await centrePixel(page, 1.25)];
  expect(frames[0][0]).toBeGreaterThan(200);
  expect(frames[1][1]).toBeGreaterThan(200);
  expect(frames[2][0]).toBeGreaterThan(200);

  // Adding the same sticker again reuses the asset (no second download/import).
  await page.getByTestId('timeline').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('End');
  await stickers.locator('[data-testid=library-item][data-path="blink.gif"]').click();
  await expect.poll(async () => (await present(page)).tracks.flatMap((t) => t.clips).length).toBe(2);
  expect(Object.keys((await present(page)).assets)).toHaveLength(1);

  // Sound effects: drag onto the audio lane at about 2 s; dropped while still downloading.
  await page.getByTestId('tab-assets').click();
  await page.getByTestId('tab-sounds').click();
  const lane = page.locator('[data-testid=track][data-track-kind=audio] [data-lane]');
  await page.getByTestId('library-sounds').getByTestId('library-item').dragTo(lane, { targetPosition: { x: 2 * 40, y: 20 } });
  await expect.poll(async () => (await present(page)).tracks.find((t) => t.kind === 'audio')!.clips.length, { timeout: 20_000 }).toBe(1);
  p = await present(page);
  const sound = p.tracks.find((t) => t.kind === 'audio')!.clips[0];
  expect(sound.start).toBeCloseTo(2, 0);
  expect(p.assets[sound.assetId!]).toMatchObject({ kind: 'audio', library: { kind: 'sounds' } });

  // Overlays: a new video track above, blended with Screen (blue over the red sticker frame → magenta).
  await page.getByTestId('tab-assets').click();
  await page.getByTestId('tab-overlays').click();
  await page.getByTestId('timeline').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Home');
  await page.getByTestId('library-overlays').getByTestId('library-item').click();
  await expect.poll(async () => (await present(page)).tracks.filter((t) => t.kind === 'video').length).toBe(2);
  p = await present(page);
  const overlay = p.tracks.filter((t) => t.kind === 'video').at(-1)!.clips[0];
  expect(overlay.blend).toBe('screen');
  const screened = await centrePixel(page, 0.25);
  expect(screened[0]).toBeGreaterThan(200); // red sticker stays
  expect(screened[2]).toBeGreaterThan(50); // plus the overlay's blue

  // Export: the GIF frames land at the same times.
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
    const px = async (t: number) => {
      const c = (await sink.getCanvas(t))!.canvas as OffscreenCanvas;
      return Array.from((c.getContext('2d') as OffscreenCanvasRenderingContext2D).getImageData(c.width >> 1, c.height >> 1, 1, 1).data.slice(0, 3));
    };
    return [await px(0.25), await px(2.75)];
  }, href);
  console.log(JSON.stringify({ frames, screened, exported }));
  expect(exported[0][0]).toBeGreaterThan(200); // red frame (+ screened blue)
  expect(exported[1][1]).toBeGreaterThan(200); // 2.75 s: second clip of the sticker, green frame
});

test('a server without a library folder explains how to add one', async ({ page }) => {
  await page.route((url) => url.pathname.startsWith('/library/'), (route) => route.fulfill({ status: 404 }));
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByTestId('tab-assets').click();
  await page.getByTestId('tab-overlays').click();
  await expect(page.getByTestId('library-empty')).toContainText('No overlays on this server yet');
  await expect(page.getByTestId('library-empty')).toContainText('library/overlays/');
});
