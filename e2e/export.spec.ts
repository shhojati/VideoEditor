import { expect, test, type Page } from '@playwright/test';

// There is no save dialog to click in automation. The download test removes the picker (in-memory
// path); the streaming test replaces it with one that returns a file in OPFS (StreamTarget path).
test.beforeEach(async ({ page }, info) => {
  if (info.title.includes('streams')) {
    await page.addInitScript(() => {
      (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async () =>
        (await navigator.storage.getDirectory()).getFileHandle('export-test.mp4', { create: true });
    });
  } else {
    await page.addInitScript(() => {
      delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    });
  }
});

async function importBlob(page: Page, make: string, name: string, mimeType: string) {
  const base64 = await page.evaluate(async (code) => {
    const blob: Blob = await new Function(`return (async () => { ${code} })()`)();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, make);
  await page.getByTestId('media-input').setInputFiles({ name, mimeType, buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]', { hasText: name })).toBeVisible({ timeout: 60_000 });
}

test('export MP4: duration, codecs, size, burned-in Persian subtitles, image and audio', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();

  await importBlob(page, `const m = await import('/spikes/export-lib.ts'); return (await m.exportTestVideo(6, 640, 360, 30)).blob;`, 'clip.mp4', 'video/mp4');
  await importBlob(
    page,
    `const c = new OffscreenCanvas(400, 300); const x = c.getContext('2d'); x.fillStyle = '#ff0000'; x.fillRect(0, 0, 400, 300); return c.convertToBlob({ type: 'image/png' });`,
    'red.png',
    'image/png',
  );

  // Timeline: video 0–6 s, red image 6–8 s; a Persian subtitle 1–3 s (Boxed preset).
  await page.evaluate(() => {
    type W = { __stores: { project: { getState: () => { history: { present: { assets: Record<string, { id: string; name: string }> } }; edit: (l: string, r: (p: never) => void) => void } } } };
    const store = (window as unknown as W).__stores.project.getState();
    const byName = (n: string) => Object.values(store.history.present.assets).find((a) => a.name === n)!;
    const clip = (assetId: string, start: number, duration: number) => ({
      id: crypto.randomUUID(), assetId, start, duration, inPoint: 0, speed: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, fit: 'cover' },
      audio: { volume: 1, fadeIn: 0, fadeOut: 0 },
    });
    store.edit('test', (p: { tracks: { kind: string; clips: unknown[] }[]; subtitleTracks: unknown[] }) => {
      p.tracks.find((t) => t.kind === 'video')!.clips = [clip(byName('clip.mp4').id, 0, 6), clip(byName('red.png').id, 6, 2)];
      p.subtitleTracks.push({
        id: crypto.randomUUID(), language: 'fa', rtl: true,
        style: { fontFamily: 'Vazirmatn', fontSize: 64, fontWeight: 700, color: '#ffffff', bgColor: '#000000', bgOpacity: 1, position: 'bottom', marginY: 40, maxWidthPct: 80 },
        cues: [{ id: 'c1', start: 1, end: 3, text: 'سلام دنیا، این یک زیرنویس است' }],
      });
    });
  });

  await page.getByTestId('open-export').click();
  const dialog = page.getByTestId('export-dialog');
  await dialog.getByRole('radio', { name: '720p' }).click();
  await dialog.getByRole('radio', { name: '30' }).click();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 120_000 });
  const url = await page.getByTestId('export-download').getAttribute('href');

  // Probe the result in the page with Mediabunny (stands in for ffprobe).
  const probe = await page.evaluate(async (href) => {
    // Mediabunny as bundled by the dev server, typed from the package.
    const depPath = '/node_modules/.vite/deps/mediabunny.js';
    const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
    const blob = await (await fetch(href!)).blob();
    const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    const v = (await input.getPrimaryVideoTrack())!;
    const a = await input.getPrimaryAudioTrack();
    const duration = await input.computeDuration();
    const sink = new mb.CanvasSink(v, { poolSize: 1 });
    const pixels = async (t: number, fx: number, fy: number) => {
      const fr = (await sink.getCanvas(t))!;
      const ctx = (fr.canvas as OffscreenCanvas).getContext('2d')!;
      return Array.from(ctx.getImageData(Math.round(fx * fr.canvas.width), Math.round(fy * fr.canvas.height), 1, 1).data);
    };
    /** Fraction of near-black pixels in the bottom band: the subtitle's opaque box (the test video has none). */
    const bottomBand = async (t: number) => {
      const fr = (await sink.getCanvas(t))!;
      const c = fr.canvas as OffscreenCanvas;
      const d = c.getContext('2d')!.getImageData(0, Math.round(c.height * 0.8), c.width, Math.round(c.height * 0.15)).data;
      let black = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] < 20 && d[i + 1] < 20 && d[i + 2] < 20) black++;
      return black / (d.length / 4);
    };
    let rms = 0;
    let n = 0;
    for await (const s of new mb.AudioSampleSink(a!).samples(2, 2.5)) {
      const buf = new Float32Array(s.numberOfFrames);
      s.copyTo(buf, { planeIndex: 0, format: 'f32-planar' });
      for (const x of buf) {
        rms += x * x;
        n++;
      }
      s.close();
    }
    return {
      duration,
      videoCodec: v.codec,
      audioCodec: a?.codec,
      width: v.displayWidth,
      height: v.displayHeight,
      subtitleAt2: await bottomBand(2),
      subtitleAt4: await bottomBand(4),
      imageCenter: await pixels(7, 0.5, 0.5),
      audioRms: Math.sqrt(rms / Math.max(1, n)),
      size: blob.size,
    };
  }, url);
  console.log(JSON.stringify(probe));

  expect(Math.abs(probe.duration - 8)).toBeLessThan(0.05);
  expect(probe.videoCodec).toBe('avc');
  expect(probe.audioCodec).toBe('aac');
  expect([probe.width, probe.height]).toEqual([1280, 720]);
  expect(probe.subtitleAt2).toBeGreaterThan(0.05); // subtitle box burned in at 2 s
  expect(probe.subtitleAt4).toBeLessThan(0.005); // gone after the cue ends
  expect(probe.imageCenter[0]).toBeGreaterThan(200); // red image at 7 s
  expect(probe.imageCenter[1]).toBeLessThan(60);
  expect(probe.audioRms).toBeGreaterThan(0.1); // the test video's 440 Hz tone (0.3 amplitude)
});

test('streams the export straight into the file chosen in the save dialog', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await importBlob(page, `const m = await import('/spikes/export-lib.ts'); return (await m.exportTestVideo(4, 640, 360, 30)).blob;`, 'clip.mp4', 'video/mp4');
  await page.locator('[data-testid=asset-card]').dragTo(page.locator('[data-testid=track][data-track-kind=video] [data-lane]'), {
    targetPosition: { x: 2, y: 20 },
  });
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-dialog').getByRole('radio', { name: '720p' }).click();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByTestId('export-download')).toHaveCount(0); // saved to disk, nothing to download

  const probe = await page.evaluate(async () => {
    // Mediabunny as bundled by the dev server, typed from the package.
    const depPath = '/node_modules/.vite/deps/mediabunny.js';
    const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
    const file = await (await (await navigator.storage.getDirectory()).getFileHandle('export-test.mp4')).getFile();
    const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
    const v = (await input.getPrimaryVideoTrack())!;
    return { duration: await input.computeDuration(), codec: v.codec, audio: (await input.getPrimaryAudioTrack())?.codec, bytes: file.size };
  });
  expect(Math.abs(probe.duration - 4)).toBeLessThan(0.05);
  expect(probe.codec).toBe('avc');
  expect(probe.audio).toBe('aac');
});
