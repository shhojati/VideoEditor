import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';

// Phase 7 DoD: a 2-minute 1080p30 project exports in under ~2× real time. Takes a few minutes, so it
// only runs with EXPORT_PERF=1.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
});

async function importGenerated(page: Page, seconds: number, name: string) {
  const base64 = await page.evaluate(async (s) => {
    const lib = '/spikes/export-lib.ts';
    const { exportTestVideo } = await import(/* @vite-ignore */ lib);
    const { blob } = await exportTestVideo(s, 1920, 1080, 30);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, seconds);
  await page.getByTestId('media-input').setInputFiles({ name, mimeType: 'video/mp4', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]', { hasText: name })).toBeVisible({ timeout: 120_000 });
}

test('2-minute 1080p30 export speed (EXPORT_PERF=1)', async ({ page }) => {
  test.skip(!process.env.EXPORT_PERF, 'set EXPORT_PERF=1 to run');
  test.setTimeout(15 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await importGenerated(page, 30, 'a.mp4');
  await importGenerated(page, 20, 'b.mp4');
  await page.evaluate(() => {
    type W = { __stores: { project: { getState: () => { history: { present: { assets: Record<string, { id: string; name: string }> } }; edit: (l: string, r: (p: never) => void) => void } } } };
    const store = (window as unknown as W).__stores.project.getState();
    const id = (n: string) => Object.values(store.history.present.assets).find((a) => a.name === n)!.id;
    const clip = (assetId: string, start: number, duration: number, inPoint = 0) => ({
      id: crypto.randomUUID(), assetId, start, duration, inPoint, speed: 1,
      transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 }, audio: { volume: 1, fadeIn: 0.5, fadeOut: 0.5 },
    });
    store.edit('test', (p: { tracks: { kind: string; clips: unknown[] }[]; subtitleTracks: unknown[] }) => {
      p.tracks.find((t) => t.kind === 'video')!.clips = [clip(id('a.mp4'), 0, 30), clip(id('b.mp4'), 30, 20), clip(id('a.mp4'), 50, 25, 5), clip(id('b.mp4'), 75, 20), clip(id('a.mp4'), 95, 25, 3)];
      p.tracks.find((t) => t.kind === 'audio')!.clips = [0, 20, 40, 60, 80, 100].map((s) => clip(id('b.mp4'), s, 20));
      p.subtitleTracks.push({
        id: crypto.randomUUID(), language: 'fa', rtl: true,
        style: { fontFamily: 'Vazirmatn', fontSize: 48, fontWeight: 600, color: '#ffffff', strokeColor: '#000000', strokeWidth: 5, position: 'bottom', marginY: 60, maxWidthPct: 80 },
        cues: Array.from({ length: 30 }, (_, i) => ({ id: `c${i}`, start: i * 4, end: i * 4 + 3, text: `زیرنویس شماره ${i + 1}، این یک جمله آزمایشی فارسی است.` })),
      });
    });
  });

  await page.getByTestId('open-export').click();
  await page.getByTestId('export-dialog').getByRole('radio', { name: '1080p' }).click();
  await page.getByTestId('export-dialog').getByRole('radio', { name: '30' }).click();
  const t0 = Date.now();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 14 * 60_000 });
  const seconds = (Date.now() - t0) / 1000;
  const url = await page.getByTestId('export-download').getAttribute('href');

  const probe = await page.evaluate(async (href) => {
    // Mediabunny as bundled by the dev server, typed from the package.
    const depPath = '/node_modules/.vite/deps/mediabunny.js';
    const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
    const blob = await (await fetch(href!)).blob();
    const input = new mb.Input({ source: new mb.BlobSource(blob), formats: mb.ALL_FORMATS });
    const v = (await input.getPrimaryVideoTrack())!;
    const fr = (await new mb.CanvasSink(v, { poolSize: 1 }).getCanvas(41))!;
    const c = fr.canvas as HTMLCanvasElement | OffscreenCanvas;
    const png = 'convertToBlob' in c ? await c.convertToBlob({ type: 'image/png' }) : await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    const b = new Uint8Array(await png.arrayBuffer());
    let bin = '';
    for (let i = 0; i < b.length; i += 0x8000) bin += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return { duration: await input.computeDuration(), w: v.displayWidth, h: v.displayHeight, bytes: blob.size, frame: btoa(bin) };
  }, url);
  writeFileSync('test-results/export-frame-41s.png', Buffer.from(probe.frame, 'base64'));
  console.log(JSON.stringify({ seconds, ratio: seconds / 120, duration: probe.duration, size: [probe.w, probe.h], mb: probe.bytes / 1e6 }));
  expect(Math.abs(probe.duration - 120)).toBeLessThan(0.05);
  expect([probe.w, probe.h]).toEqual([1920, 1080]);
  expect(seconds / 120).toBeLessThan(2);
});
