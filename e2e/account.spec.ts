import { expect, test, type Page } from '@playwright/test';
import { STORAGE_STATE } from './support/account';

// Logged out to start with; the Pro admin (global setup) activates Pro from the admin page.
test.use({ storageState: { cookies: [], origins: [] } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  });
});

/** One red image clip of `seconds` on the timeline. */
async function redTimeline(page: Page, seconds: number) {
  await page.evaluate(async (seconds) => {
    type Store = {
      getState: () => {
        history: { present: { assets: Record<string, { id: string; name: string }> } };
        edit: (l: string, r: (p: never) => void) => void;
      };
    };
    const store = (window as unknown as { __stores: { project: Store } }).__stores.project.getState();
    const red = Object.values(store.history.present.assets).find((a) => a.name === 'red.png')!;
    store.edit('test', (p: { tracks: { kind: string; clips: unknown[] }[] }) => {
      p.tracks.find((t) => t.kind === 'video')!.clips = [
        {
          id: crypto.randomUUID(),
          assetId: red.id,
          start: 0,
          duration: seconds,
          inPoint: 0,
          speed: 1,
          transform: { x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, fit: 'cover' },
          audio: { volume: 1, fadeIn: 0, fadeOut: 0 },
        },
      ];
    });
  }, seconds);
}

/** Exports the frame under the playhead as PNG; returns how many pixels in the bottom-right quarter are not red. */
async function exportFrameAndCountMarks(page: Page) {
  await page.getByTestId('open-export').click();
  const dialog = page.getByTestId('export-dialog');
  await dialog.getByTestId('export-format').getByRole('combobox').selectOption('png');
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 60_000 });
  const href = (await page.getByTestId('export-download').getAttribute('href'))!;
  const marks = await page.evaluate(async (href) => {
    const bmp = await createImageBitmap(await (await fetch(href)).blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height);
    const x = c.getContext('2d')!;
    x.drawImage(bmp, 0, 0);
    const { data } = x.getImageData(bmp.width / 2, bmp.height / 2, bmp.width / 2, bmp.height / 2);
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i + 1] > 80 && data[i + 2] > 80) n++;
    return n;
  }, href);
  await page.getByTestId('export-dialog').getByRole('button', { name: 'Close' }).click();
  return marks;
}

test('export needs an account; Free exports ≤ 60 s with a watermark; Pro removes both limits', async ({ page, browser }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  const png = await page.evaluate(async () => {
    const c = new OffscreenCanvas(640, 360);
    const x = c.getContext('2d')!;
    x.fillStyle = '#ff0000';
    x.fillRect(0, 0, 640, 360);
    const bytes = new Uint8Array(await (await c.convertToBlob({ type: 'image/png' })).arrayBuffer());
    return Array.from(bytes);
  });
  await page.getByTestId('media-input').setInputFiles({ name: 'red.png', mimeType: 'image/png', buffer: Buffer.from(png) });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]', { hasText: 'red.png' })).toBeVisible();
  await redTimeline(page, 2);

  // Logged out: editing works, export asks to log in.
  await page.getByTestId('open-export').click();
  await expect(page.getByTestId('export-gate')).toHaveAttribute('data-gate', 'login');
  await expect(page.getByTestId('export-start')).toHaveCount(0);
  await page.getByTestId('export-login').click();

  // Register a Free account from there.
  const email = `buyer-${Date.now()}@example.com`;
  await page.getByTestId('auth-switch').click();
  await page.getByTestId('auth-email').fill(email);
  await page.getByTestId('auth-password').fill('short');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('auth-dialog')).toBeVisible(); // browser validation: 8+ characters
  await page.getByTestId('auth-password').fill('buyer-password');
  await page.getByTestId('auth-submit').click();
  await expect(page.getByTestId('auth-dialog')).toHaveCount(0);
  await expect(page.getByTestId('export-gate')).toHaveAttribute('data-gate', 'watermark');
  await page.getByTestId('export-dialog').getByRole('button', { name: 'Close' }).click();

  // Free, 2 s: exports, with the watermark in the bottom-right corner.
  expect(await exportFrameAndCountMarks(page)).toBeGreaterThan(50);

  // Free, 70 s: blocked; the upgrade dialog shows the account code and how to pay.
  await redTimeline(page, 70);
  await page.getByTestId('open-export').click();
  await page.getByTestId('export-format').getByRole('combobox').selectOption('mp4');
  await expect(page.getByTestId('export-gate')).toHaveAttribute('data-gate', 'tooLong');
  await expect(page.getByTestId('export-start')).toBeDisabled();
  await page.getByTestId('export-upgrade').click();
  const account = page.getByTestId('account-dialog');
  const code = (await account.getByTestId('account-code').textContent())!;
  expect(code).toMatch(/^U-\d+$/);
  await expect(account.getByTestId('account-plan')).toHaveAttribute('data-plan', 'free');
  await expect(account.getByTestId('account-message')).toContainText(code);
  await expect(account.getByTestId('account-telegram')).toHaveAttribute('href', /^https:\/\/t\.me\//);
  await expect(account.getByTestId('account-passes').locator('li')).toHaveCount(3);
  await account.getByRole('button', { name: 'Close' }).click();
  await page.getByTestId('export-dialog').getByRole('button', { name: 'Close' }).click();

  // The owner activates one month of Pro on the admin page.
  const owner = await browser.newContext({ storageState: STORAGE_STATE });
  const admin = await owner.newPage();
  admin.on('dialog', (d) => void d.accept());
  await admin.goto('/admin.html');
  await admin.getByRole('button', { name: 'English' }).click();
  await admin.getByTestId('admin-search').fill(code);
  await admin.getByTestId('admin-search').press('Enter');
  const row = admin.getByTestId('admin-user').filter({ hasText: email });
  await expect(row).toHaveCount(1);
  await row.getByTestId('admin-grant').click();
  await expect(row.getByTestId('admin-plan')).toContainText('Pro until');
  await owner.close();

  // Opening the export dialog re-reads the plan: no limit, no watermark.
  await page.getByTestId('open-export').click();
  await expect(page.getByTestId('export-gate')).toHaveCount(0);
  await page.getByTestId('export-dialog').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('account-button')).toContainText('PRO');
  expect(await exportFrameAndCountMarks(page)).toBe(0);
});
