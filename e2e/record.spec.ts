// Voiceover and webcam recording with Chrome's fake devices (a beep and a test pattern; see
// playwright.config.ts): the take is imported and lands on a new track at the playhead.
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
});

type ClipState = { start: number; duration: number; assetId?: string };
type W = {
  __stores: {
    project: {
      getState: () => { history: { present: { tracks: { kind: string; clips: ClipState[] }[]; assets: Record<string, { name: string; kind: string }> } } };
    };
    transport: { getState: () => { seek: (t: number) => void } };
  };
};
const state = (page: Page) =>
  page.evaluate(() => {
    const p = (window as unknown as W).__stores.project.getState().history.present;
    return { tracks: p.tracks.map((t) => ({ kind: t.kind, clips: t.clips })), assets: Object.values(p.assets) };
  });

async function recordTake(page: Page, seconds: number) {
  await page.getByTestId('record-start').click();
  await expect(page.getByTestId('record-countdown')).toBeVisible();
  await expect(page.getByTestId('record-stop')).toBeVisible({ timeout: 6000 });
  await page.waitForTimeout(seconds * 1000);
  await page.getByTestId('record-stop').click();
}

test('record a voiceover and a webcam take onto new tracks', async ({ page }) => {
  test.setTimeout(2 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();

  await page.getByTestId('record-open').click();
  const dialog = page.getByTestId('record-dialog');
  await expect(dialog).toBeVisible();
  // The fake mic beeps briefly once a second (silent in between): watch every meter update.
  const peak = await page.evaluate(async () => {
    const lib = '/src/features/record/recordService.ts';
    const { useRecord } = await import(/* @vite-ignore */ lib);
    let max = 0;
    const unsub = useRecord.subscribe((s: { level: number }) => (max = Math.max(max, s.level)));
    await new Promise((r) => setTimeout(r, 3000));
    unsub();
    return max;
  });
  expect(peak).toBeGreaterThan(0.3);

  await recordTake(page, 2);
  await expect(page.locator('[data-testid=asset-card][data-status=ready]', { hasText: 'Voiceover 1' })).toBeVisible({ timeout: 30_000 });
  let s = await state(page);
  expect(s.assets.find((a) => a.name.startsWith('Voiceover 1'))?.kind).toBe('audio');
  const audio = s.tracks.filter((t) => t.kind === 'audio').flatMap((t) => t.clips);
  expect(audio).toHaveLength(1);
  expect(audio[0].start).toBeLessThan(0.3);
  expect(audio[0].duration).toBeGreaterThan(1.4);
  expect(audio[0].duration).toBeLessThan(3);

  // With the camera on, the take is a video clip, placed at the playhead.
  await page.evaluate(() => (window as unknown as W).__stores.transport.getState().seek(1));
  await dialog.getByRole('checkbox', { name: 'Camera' }).check();
  await expect(page.getByTestId('record-camera-preview')).toBeVisible({ timeout: 10_000 });
  await recordTake(page, 2);
  await expect(page.locator('[data-testid=asset-card][data-status=ready]', { hasText: 'Camera 2' })).toBeVisible({ timeout: 30_000 });
  s = await state(page);
  expect(s.assets.find((a) => a.name.startsWith('Camera 2'))?.kind).toBe('video');
  const video = s.tracks.filter((t) => t.kind === 'video').flatMap((t) => t.clips);
  expect(video).toHaveLength(1);
  expect(video[0].start).toBeGreaterThan(0.7);
  expect(video[0].start).toBeLessThan(1.3);

  await dialog.getByRole('button', { name: 'Close' }).click();
  await expect(dialog).toBeHidden();
});
