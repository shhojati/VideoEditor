import { expect, test, type Page } from '@playwright/test';

const timelineHeight = (page: Page) =>
  page.locator('section[aria-label]', { has: page.getByTestId('timeline') }).evaluate((el) => el.getBoundingClientRect().height);

test('timeline height: drag the splitter, remembered after reload, arrow keys', async ({ page }) => {
  await page.goto('/');
  const splitter = page.getByTestId('timeline-splitter');
  await expect(splitter).toBeVisible();
  const before = await timelineHeight(page);

  const box = (await splitter.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x, y - 100, { steps: 5 });
  await page.mouse.up();
  const taller = await timelineHeight(page);
  expect(taller).toBeGreaterThan(before + 90);
  expect(taller).toBeLessThan(before + 110);

  await page.reload();
  await expect.poll(() => timelineHeight(page)).toBeCloseTo(taller, -1);

  await page.getByTestId('timeline-splitter').focus();
  await page.keyboard.press('ArrowDown');
  expect(await timelineHeight(page)).toBeLessThan(taller - 20);
  // Never smaller than the minimum.
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown');
  expect(await timelineHeight(page)).toBeGreaterThanOrEqual(119);
});

test.describe('phone', () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });
  test('the splitter between preview and timeline resizes both', async ({ page }) => {
    // The welcome card sits over the middle of a phone screen, where the splitter is.
    await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
    await page.goto('/');
    const preview = page.getByTestId('preview-canvas');
    await expect(page.getByTestId('mobile-layout')).toBeVisible();
    const before = await timelineHeight(page);
    const box = (await page.getByTestId('timeline-splitter').boundingBox())!;
    await page.mouse.move(box.x + 180, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 180, box.y + 120, { steps: 5 });
    await page.mouse.up();
    expect(await timelineHeight(page)).toBeLessThan(before - 100);
    await expect(preview).toBeVisible();
  });
});

test('a shorter timeline plus narrower side panels gives a bigger preview (LTR and RTL)', async ({ page }) => {
  await page.goto('/');
  const canvas = page.getByTestId('preview-canvas');
  const size = async () => (await canvas.boundingBox())!;
  await expect.poll(async () => (await size()).width).toBeGreaterThan(0);
  const start = await size();

  // Shrink the timeline to its minimum: the 16:9 picture is width-bound, so it barely changes.
  await page.getByTestId('timeline-splitter').focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowDown');

  for (const dir of ['ltr', 'rtl'] as const) {
    await page.evaluate((d) => (document.documentElement.dir = d), dir);
    await page.getByTestId('column-splitter-start').dblclick();
    await page.getByTestId('column-splitter-end').dblclick();
    const before = await size();
    // Drag each splitter toward its own panel's outer edge.
    for (const col of ['start', 'end'] as const) {
      const b = (await page.getByTestId(`column-splitter-${col}`).boundingBox())!;
      const outward = (col === 'start') === (dir === 'ltr') ? -1 : 1;
      await page.mouse.move(b.x + 2, b.y + b.height / 2);
      await page.mouse.down();
      await page.mouse.move(b.x + 2 + outward * 150, b.y + b.height / 2, { steps: 5 });
      await page.mouse.up();
    }
    await expect.poll(async () => (await size()).width).toBeGreaterThan(before.width + 100);
    // The picture keeps its aspect and fits the box.
    const after = await size();
    expect(after.width / after.height).toBeCloseTo(16 / 9, 1);
  }
  expect((await size()).height).toBeGreaterThan(start.height);
});
