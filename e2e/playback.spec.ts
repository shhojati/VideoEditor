import { expect, test, type Page } from '@playwright/test';

// Phase 4 DoD: a multi-clip, multi-track timeline plays for 2 minutes with A/V drift < 80 ms.
// Video frames are chosen by the audio clock, so drift = how far the shown frame trails the clock
// + how late audio buffers start. Both are measured by the engine (window.__playback.stats).

test.use({ launchOptions: { args: ['--autoplay-policy=no-user-gesture-required'] } });

async function importGenerated(page: Page, seconds: number, name: string) {
  const base64 = await page.evaluate(async (s) => {
    const lib = '/spikes/export-lib.ts';
    const { exportTestVideo } = await import(/* @vite-ignore */ lib);
    const { blob } = await exportTestVideo(s, 960, 540, 30);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, seconds);
  await page.getByTestId('media-input').setInputFiles({ name, mimeType: 'video/mp4', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]', { hasText: name })).toBeVisible({ timeout: 60_000 });
}

test('2-minute multi-track playback stays in sync', async ({ page }) => {
  test.setTimeout(6 * 60_000);
  await page.goto('/');
  await importGenerated(page, 30, 'a.mp4');
  await importGenerated(page, 20, 'b.mp4');

  // Build the edit through the store (drag and drop is covered by timeline.spec): 5 clips on the
  // video track back to back = 120 s, with b.mp4's audio repeated on the audio track.
  await page.evaluate(() => {
    type W = { __stores: { project: { getState: () => { edit: (l: string, r: (p: never) => void) => void } } } };
    const { edit } = (window as unknown as W).__stores.project.getState();
    edit('test', (p: { assets: Record<string, { id: string; name: string; duration: number }>; tracks: { kind: string; clips: unknown[] }[] }) => {
      const byName = (n: string) => Object.values(p.assets).find((a) => a.name === n)!;
      const a = byName('a.mp4');
      const b = byName('b.mp4');
      const clip = (asset: { id: string }, start: number, duration: number, inPoint = 0) => ({
        id: crypto.randomUUID(), assetId: asset.id, start, duration, inPoint, speed: 1,
        transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 },
        audio: { volume: 1, fadeIn: 0.5, fadeOut: 0.5 },
      });
      const video = p.tracks.find((t) => t.kind === 'video')!;
      const audio = p.tracks.find((t) => t.kind === 'audio')!;
      video.clips = [clip(a, 0, 30), clip(b, 30, 20), clip(a, 50, 25, 5), clip(b, 75, 20), clip(a, 95, 25, 3)];
      audio.clips = [0, 20, 40, 60, 80, 100].map((s) => clip(b, s, 20));
    });
  });
  await expect(page.getByTestId('clip')).not.toHaveCount(0);

  const wallStart = Date.now();
  await page.getByTestId('play').click();
  // Sample the clock against wall time while it plays.
  const samples: { wall: number; clock: number }[] = [];
  while (Date.now() - wallStart < 122_000) {
    await page.waitForTimeout(5_000);
    const clock = await page.evaluate(
      () => (window as unknown as { __stores: { transport: { getState: () => { time: number } } } }).__stores.transport.getState().time,
    );
    samples.push({ wall: (Date.now() - wallStart) / 1000, clock });
    if (clock >= 119.9) break;
  }
  const stats = await page.evaluate(() => (window as unknown as { __playback: { stats: unknown } }).__playback.stats);
  console.log(JSON.stringify(stats));
  console.log(JSON.stringify(samples.slice(-3)));

  const { video, audio } = stats as {
    video: { frames: number; dropped: number; maxLag: number; sumLag: number };
    audio: { buffers: number; lateBuffers: number; maxLate: number };
  };
  expect(video.frames).toBeGreaterThan(1000);
  expect(video.maxLag).toBeLessThan(0.08);
  expect(audio.buffers).toBeGreaterThan(100);
  expect(audio.maxLate).toBeLessThan(0.08);
  // The playhead reached the end and stopped.
  await expect(page.getByTestId('play')).toHaveAttribute('data-state', 'paused', { timeout: 10_000 });
  expect(samples.at(-1)!.clock).toBeGreaterThan(115);
});
