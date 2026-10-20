import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

test('phone layout: bottom navigation, tap-to-add media and the properties sheet', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('mobile-layout')).toBeVisible();
  await expect(page.getByTestId('preview-canvas')).toBeVisible();
  // Nothing spills sideways.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  // Media opens as a sheet over the timeline; the preview stays visible.
  await page.getByTestId('nav-media').tap();
  await expect(page.getByTestId('mobile-sheet')).toBeVisible();
  const base64 = await page.evaluate(async () => {
    const lib = '/spikes/export-lib.ts';
    const { exportTestVideo } = await import(/* @vite-ignore */ lib);
    const { blob } = await exportTestVideo(2, 320, 180, 30);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  await page.getByTestId('media-input').setInputFiles({ name: 'phone.mp4', mimeType: 'video/mp4', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]')).toBeVisible();

  // Tap + : the clip lands at the playhead and the sheet closes to show it.
  await page.getByTestId('asset-add').tap();
  await expect(page.getByTestId('mobile-sheet')).toBeHidden();
  const clip = page.getByTestId('clip');
  await expect(clip).toHaveCount(1);
  await expect(clip).toHaveAttribute('data-start', '0.000');
  await expect(clip).toHaveAttribute('data-selected', 'true');

  // The selected clip's properties; tapping the active tab again closes the sheet.
  await page.getByTestId('nav-inspector').tap();
  await expect(page.getByTestId('mobile-sheet')).toBeVisible();
  await page.getByTestId('nav-inspector').tap();
  await expect(page.getByTestId('mobile-sheet')).toBeHidden();
});
