// The merged left-panel tabs, the top bar's search (Ctrl+K) and the clip menu's Reset.
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
});

type W = {
  __stores: {
    project: { getState: () => { history: { present: { tracks: { clips: { id: string; blend?: string; effects?: { kind: string }[] }[] }[] } } } };
  };
};
const clips = (page: Page) => page.evaluate(() => (window as unknown as W).__stores.project.getState().history.present.tracks.flatMap((t) => t.clips));

test('five tabs in order, each with its views', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  const top = page.getByRole('tablist').first().getByRole('tab');
  await expect(top).toHaveText(['Media', 'Subtitles', 'Effects', 'Assets', 'Templates']);
  await page.getByTestId('tab-fx').click();
  for (const id of ['effects', 'transitions', 'filters']) await expect(page.getByTestId(`tab-${id}`)).toBeVisible();
  await page.getByTestId('tab-assets').click();
  for (const id of ['stickers', 'sounds', 'backgrounds', 'overlays']) await expect(page.getByTestId(`tab-${id}`)).toBeVisible();
  await page.getByTestId('tab-templates').click();
  await page.getByTestId('tab-layouts').click();
  await expect(page.getByTestId('tab-layouts')).toHaveAttribute('aria-selected', 'true');
});

test('search applies an effect, a filter and a blend mode; Reset removes them in one undo step', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByTestId('btn-add-shape').click();
  await page.getByTestId('add-shape-square').click();
  const clip = page.getByTestId('clip').first();
  await expect(clip).toHaveAttribute('data-selected', 'true');

  // Ctrl+K, type, Enter: the best match is applied to the selected clip.
  await page.keyboard.press('Control+KeyK');
  const box = page.getByTestId('global-search');
  await expect(box).toBeFocused();
  await box.fill('gaussian');
  await expect(page.getByTestId('search-result').first()).toHaveAttribute('data-id', 'effect:gaussianBlur');
  await box.press('Enter');
  await expect(box).toHaveValue('');

  // A click on a result.
  await box.fill('mono');
  await page.locator('[data-testid=search-result][data-id="filter:mono"]').click();
  await box.fill('screen');
  await page.locator('[data-testid=search-result][data-id="blend:screen"]').click();

  let [c] = await clips(page);
  expect(c.effects?.map((e) => e.kind)).toEqual(['gaussianBlur', 'look']);
  expect(c.blend).toBe('screen');

  await clip.click({ button: 'right' });
  await page.getByTestId('clip-menu-reset').click();
  [c] = await clips(page);
  expect(c.effects).toBeUndefined();
  expect(c.blend).toBeUndefined();

  await page.keyboard.press('Control+KeyZ');
  [c] = await clips(page);
  expect(c.effects).toHaveLength(2);
  expect(c.blend).toBe('screen');
});
