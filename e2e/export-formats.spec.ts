import { expect, test, type Page } from '@playwright/test';

// Every non-MP4 format: export a 3 s clip (640×360 test video with a 440 Hz tone) and probe the file
// in the page — Mediabunny for MOV/WebM/MP3, WebCodecs for AVI, ImageDecoder for GIF/PNG, our ZIP
// reader for image sequences. The save picker is removed so results come back as downloads.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  const base64 = await page.evaluate(async () => {
    const lib = '/spikes/export-lib.ts';
    const m = await import(/* @vite-ignore */ lib);
    const blob: Blob = (await m.exportTestVideo(3, 640, 360, 30)).blob;
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000)
      bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  await page
    .getByTestId('media-input')
    .setInputFiles({ name: 'clip.mp4', mimeType: 'video/mp4', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]')).toBeVisible({ timeout: 60_000 });
  await page
    .locator('[data-testid=asset-card]')
    .dragTo(page.locator('[data-testid=track][data-track-kind=video] [data-lane]'), {
      targetPosition: { x: 2, y: 20 },
    });
});

/** Opens the dialog, picks the format, runs `configure`, exports, and returns the download URL. */
/** Frames the export renders: the timeline (the clip's real length, a little over 3 s) at `fps`. */
async function expectedFrames(page: Page, fps: number) {
  const duration = await page.evaluate(
    () =>
      (
        window as unknown as { __stores: { transport: { getState: () => { duration: number } } } }
      ).__stores.transport.getState().duration,
  );
  return Math.max(1, Math.ceil(duration * fps - 1e-6));
}

async function exportAs(page: Page, format: string, configure?: () => Promise<void>) {
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-format').getByRole('combobox').selectOption(format);
  await configure?.();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 120_000 });
  const done = (await page.getByTestId('export-done').textContent()) ?? '';
  return {
    url: (await page.getByTestId('export-download').getAttribute('href'))!,
    name: (await page.getByTestId('export-download').getAttribute('download'))!,
    done,
  };
}

async function probeMedia(page: Page, url: string) {
  return page.evaluate(async (href) => {
    const depPath = '/node_modules/.vite/deps/mediabunny.js';
    const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
    const blob = await (await fetch(href)).blob();
    const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    const v = await input.getPrimaryVideoTrack();
    const a = await input.getPrimaryAudioTrack();
    let firstFrame = false;
    if (v)
      for await (const s of new mb.VideoSampleSink(v).samples(1, 1.1)) {
        firstFrame = true;
        s.close();
      }
    return {
      mime: await input.getMimeType(),
      duration: await input.computeDuration(),
      video: v?.codec ?? null,
      audio: a?.codec ?? null,
      width: v?.displayWidth ?? 0,
      height: v?.displayHeight ?? 0,
      decodes: firstFrame,
      bytes: blob.size,
    };
  }, url);
}

test('MOV, WebM and MP3 through Mediabunny, with the bitrate shown and typed', async ({ page }) => {
  test.setTimeout(4 * 60_000);
  const mov = await exportAs(page, 'mov', async () => {
    await page.getByTestId('export-dialog').getByRole('radio', { name: '720p' }).click();
    await page.getByTestId('export-video-bitrate').fill('2000');
    await page.getByTestId('export-video-bitrate').press('Enter');
    await expect(page.getByTestId('export-bitrate')).toContainText(
      '2000 kbps video + 160 kbps audio = 2160 kbps',
    );
    await expect(page.getByTestId('export-dialog').getByRole('radio', { name: 'Custom' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
  expect(mov.name).toMatch(/\.mov$/);
  expect(mov.done).toMatch(/Average bitrate: \d+ kbps/);
  const movProbe = await probeMedia(page, mov.url);
  expect(movProbe).toMatchObject({
    mime: expect.stringContaining('quicktime'),
    video: 'avc',
    audio: 'aac',
    width: 1280,
    height: 720,
    decodes: true,
  });
  expect(Math.abs(movProbe.duration - 3)).toBeLessThan(0.05);
  // ~2 Mbps + 160 kbps over 3 s, give or take the encoder's rate control.
  expect(movProbe.bytes).toBeGreaterThan(300_000);
  expect(movProbe.bytes).toBeLessThan(1_500_000);

  await page.getByRole('button', { name: 'Close' }).click();
  const webm = await exportAs(page, 'webm', async () => {
    await page.getByTestId('export-dialog').getByRole('radio', { name: '720p' }).click();
  });
  expect(webm.name).toMatch(/\.webm$/);
  const webmProbe = await probeMedia(page, webm.url);
  expect(webmProbe).toMatchObject({ mime: expect.stringContaining('webm'), audio: 'opus', decodes: true });
  expect(['vp9', 'vp8']).toContain(webmProbe.video);
  expect(Math.abs(webmProbe.duration - 3)).toBeLessThan(0.1);

  await page.getByRole('button', { name: 'Close' }).click();
  const mp3 = await exportAs(page, 'mp3', async () => {
    await expect(page.getByTestId('export-dialog').getByRole('radio', { name: '720p' })).toHaveCount(0);
    await page.getByTestId('export-dialog').getByLabel('Audio bitrate').selectOption('192000');
    await expect(page.getByTestId('export-bitrate')).toContainText('192 kbps audio');
  });
  expect(mp3.name).toMatch(/\.mp3$/);
  const mp3Probe = await probeMedia(page, mp3.url);
  expect(mp3Probe).toMatchObject({ video: null, audio: 'mp3' });
  expect(Math.abs(mp3Probe.duration - 3)).toBeLessThan(0.1);
  expect(mp3Probe.bytes).toBeGreaterThan(60_000); // 192 kbps × 3 s = 72 kB
});

test('AVI: H.264 that WebCodecs decodes, PCM audio, a complete index', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  const avi = await exportAs(page, 'avi', async () => {
    await page.getByTestId('export-dialog').getByRole('radio', { name: '720p' }).click();
    await expect(page.getByTestId('export-dialog')).toContainText('uncompressed 16-bit PCM, 1536 kbps');
  });
  expect(avi.name).toMatch(/\.avi$/);
  const frames = await expectedFrames(page, 30);
  const probe = await page.evaluate(async (href) => {
    const b = new Uint8Array(await (await fetch(href)).arrayBuffer());
    const v = new DataView(b.buffer);
    const cc = (at: number) => String.fromCharCode(...b.subarray(at, at + 4));
    const hdrlEnd = 20 + v.getUint32(16, true);
    const movi = hdrlEnd + 8;
    const moviEnd = movi + v.getUint32(hdrlEnd + 4, true);
    const video: { data: Uint8Array; key: boolean }[] = [];
    let audioBytes = 0;
    let at = movi + 4;
    while (at < moviEnd) {
      const n = v.getUint32(at + 4, true);
      if (cc(at) === '00dc') video.push({ data: b.subarray(at + 8, at + 8 + n), key: false });
      else if (cc(at) === '01wb') audioBytes += n;
      at += 8 + n + (n & 1);
    }
    const idxCount = v.getUint32(at + 4, true) / 16;
    for (let i = 0, k = 0; i < idxCount; i++) {
      const e = at + 8 + i * 16;
      if (cc(e) === '00dc') video[k++].key = (v.getUint32(e + 4, true) & 0x10) !== 0;
    }
    // Decode every frame from the raw Annex B stream (no avcC: parameter sets are in-band).
    let decoded = 0;
    let firstWidth = 0;
    const decoder = new VideoDecoder({
      output: (f) => {
        decoded++;
        firstWidth ||= f.displayWidth;
        f.close();
      },
      error: () => {},
    });
    decoder.configure({ codec: 'avc1.640028' });
    video.forEach((f, i) =>
      decoder.decode(
        new EncodedVideoChunk({ type: f.key ? 'key' : 'delta', timestamp: (i * 1e6) / 30, data: f.data }),
      ),
    );
    await decoder.flush();
    return {
      riff: cc(0) + cc(8),
      riffSize: v.getUint32(4, true) === b.length - 8,
      totalFrames: v.getUint32(48, true),
      size: [v.getUint32(64, true), v.getUint32(68, true)],
      chunks: video.length,
      firstKey: video[0].key,
      keys: video.filter((f) => f.key).length,
      decoded,
      firstWidth,
      audioSeconds: audioBytes / (48_000 * 4),
      idx1: cc(at),
    };
  }, avi.url);
  expect(probe).toMatchObject({
    riff: 'RIFFAVI ',
    riffSize: true,
    totalFrames: frames,
    size: [1280, 720],
    chunks: frames,
    firstKey: true,
    idx1: 'idx1',
    decoded: frames,
    firstWidth: 1280,
  });
  expect(probe.keys).toBeGreaterThanOrEqual(2); // every 2 s
  expect(Math.abs(probe.audioSeconds - 3)).toBeLessThan(0.01);
});

test('GIF and PNG/JPG: animation, the frame under the playhead, and a ZIP of every frame', async ({
  page,
}) => {
  test.setTimeout(4 * 60_000);
  const gif = await exportAs(page, 'gif', async () => {
    const dialog = page.getByTestId('export-dialog');
    await expect(dialog.getByRole('radio', { name: '1080p' })).toHaveCount(0);
    await dialog.getByRole('radio', { name: '240p' }).click();
    await dialog.getByRole('radio', { name: '10' }).click();
    await expect(dialog).toContainText('no sound');
  });
  expect(gif.name).toMatch(/\.gif$/);
  const gifProbe = await page.evaluate(async (href) => {
    const blob = await (await fetch(href)).blob();
    const dec = new ImageDecoder({ data: blob.stream(), type: 'image/gif' });
    await dec.tracks.ready;
    await dec.completed;
    const { image } = await dec.decode({ frameIndex: 15 });
    const out = {
      frames: dec.tracks.selectedTrack!.frameCount,
      repetition: dec.tracks.selectedTrack!.repetitionCount,
      width: image.displayWidth,
      height: image.displayHeight,
      duration: image.duration,
    };
    image.close();
    return out;
  }, gif.url);
  expect(gifProbe).toMatchObject({
    frames: await expectedFrames(page, 10),
    repetition: Infinity,
    width: 426,
    height: 240,
    duration: 100_000,
  });

  // PNG of the frame under the playhead.
  await page.getByRole('button', { name: 'Close' }).click();
  await page.evaluate(() =>
    (
      window as unknown as { __stores: { transport: { getState: () => { seek: (t: number) => void } } } }
    ).__stores.transport
      .getState()
      .seek(1.5),
  );
  const png = await exportAs(page, 'png', async () => {
    await expect(
      page.getByTestId('export-dialog').getByRole('radio', { name: 'Current frame (0:01.5)' }),
    ).toHaveAttribute('aria-checked', 'true');
    // The dialog keeps its settings: GIF's 240p became 720p, the nearest PNG size.
    await expect(page.getByTestId('export-dialog').getByRole('radio', { name: '720p' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.getByTestId('export-dialog').getByRole('radio', { name: '1080p' }).click();
  });
  expect(png.name).toMatch(/\.png$/);
  const pngProbe = await page.evaluate(async (href) => {
    const bmp = await createImageBitmap(await (await fetch(href)).blob());
    return [bmp.width, bmp.height];
  }, png.url);
  expect(pngProbe).toEqual([1920, 1080]);

  await page.getByRole('button', { name: 'Close' }).click();
  const zip = await exportAs(page, 'jpg', async () => {
    const dialog = page.getByTestId('export-dialog');
    await dialog.getByRole('radio', { name: 'All frames (ZIP)' }).click();
    await dialog.getByRole('radio', { name: '720p' }).click();
    await dialog.getByRole('radio', { name: '24' }).click();
  });
  expect(zip.name).toMatch(/\.zip$/);
  const zipProbe = await page.evaluate(async (href) => {
    const zipPath = '/src/lib/zip.ts';
    const { readZip } = await import(/* @vite-ignore */ zipPath);
    const entries: { name: string; blob: Blob }[] = await readZip(await (await fetch(href)).blob());
    const last = await createImageBitmap(entries[entries.length - 1].blob);
    return {
      count: entries.length,
      first: entries[0].name,
      last: entries[entries.length - 1].name,
      size: [last.width, last.height],
    };
  }, zip.url);
  const jpgs = await expectedFrames(page, 24);
  expect(zipProbe).toEqual({
    count: jpgs,
    first: 'frame_0001.jpg',
    last: `frame_${String(jpgs).padStart(4, '0')}.jpg`,
    size: [1280, 720],
  });
});
