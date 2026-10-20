import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

// Production build, real UI only (no dev hooks): a new user's path from an empty editor to an MP4.
test.beforeEach(async ({ page }) => {
  // No save dialog to click in automation: use the download path.
  await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
});

test('new user: sample project → split → edit subtitle → export MP4, no console errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto('/');
  await expect(page.getByTestId('unsupported')).toHaveCount(0);
  await page.getByRole('button', { name: 'English' }).click();

  // Onboarding → sample project.
  await expect(page.getByTestId('onboarding')).toBeVisible();
  await page.getByTestId('load-sample').click();
  await expect(page.getByTestId('clip')).toHaveCount(2, { timeout: 30_000 }); // video + text
  await expect(page.getByTestId('cue')).toHaveCount(2);

  // Split the video at 3 s: click the ruler there, select the video clip, press S.
  const lane = (await page.locator('[data-testid=track][data-track-kind=video] [data-lane]').boundingBox())!;
  const ruler = (await page.getByTestId('ruler').boundingBox())!;
  await page.mouse.click(lane.x + 3 * 40, ruler.y + 10);
  await page.locator('[data-testid=track][data-track-kind=video] [data-testid=clip]').click({ position: { x: 10, y: 10 } });
  await page.keyboard.press('s');
  await expect(page.locator('[data-testid=track][data-track-kind=video] [data-testid=clip]')).toHaveCount(2);

  // Edit a subtitle in the Subtitles tab.
  await page.getByTestId('tab-subtitles').click();
  await page.getByTestId('cue-text').first().fill('سلام! این زیرنویس ویرایش شد.');
  await expect(page.getByTestId('cue').first()).toContainText('ویرایش شد');

  // Shortcut sheet opens with "?" and closes with Escape.
  await page.getByTestId('timeline').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Shift+Slash');
  await expect(page.getByTestId('shortcut-sheet')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('shortcut-sheet')).toHaveCount(0);

  // Export 720p and download.
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-dialog').getByRole('radio', { name: '720p' }).click();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 90_000 });
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-download').click()]);
  const chunks: Buffer[] = [];
  for await (const c of await download.createReadStream()) chunks.push(c as Buffer);
  const mp4 = Buffer.concat(chunks);
  expect(download.suggestedFilename()).toBe('Sample project.mp4');
  expect(mp4.length).toBeGreaterThan(100_000);
  expect(mp4.subarray(4, 8).toString('latin1')).toBe('ftyp'); // an MP4 file

  // Survives a reload.
  await page.reload();
  await expect(page.getByTestId('clip')).toHaveCount(3);

  expect(errors).toEqual([]);
});

test('accessibility: no serious or critical axe violations (fa and en)', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('onboarding')).toBeVisible();
  await page.getByTestId('load-sample').click();
  await expect(page.getByTestId('clip')).toHaveCount(2, { timeout: 30_000 });
  for (const lang of ['fa', 'en']) {
    if (lang === 'en') await page.getByRole('button', { name: 'English' }).click();
    const results = await new AxeBuilder({ page }).analyze();
    const serious = results.violations
      .filter((v) => v.impact === 'serious' || v.impact === 'critical')
      .map((v) => `${v.id} (${v.nodes.length}): ${v.nodes.slice(0, 3).map((n) => n.target.join(' ')).join(' | ')}`);
    expect(serious, `${lang}: ${serious.join('\n')}`).toEqual([]);
  }
});
