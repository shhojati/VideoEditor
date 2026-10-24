import { expect, test, type Page } from '@playwright/test';

type TextState = { content: string; rtl: boolean; fontSize: number; color: string; fontFamily: string; fontWeight: number; bgColor?: string };

/** Text props of all text clips, in timeline order (dev-only store handle). */
const texts = (page: Page) =>
  page.evaluate(() => {
    type P = { tracks: { clips: { start: number; text?: unknown; transform: { y: number } }[] }[] };
    const w = window as unknown as { __stores?: { project: { getState: () => { history: { present: P } | null } } } };
    // Before the project has (re)loaded there is no history yet.
    return (w.__stores?.project.getState().history?.present.tracks ?? [])
      .flatMap((t) => t.clips)
      .filter((c) => c.text)
      .sort((a, b) => a.start - b.start)
      .map((c) => ({ ...(c.text as object), y: c.transform.y })) as (TextState & { y: number })[];
  });

const seek = (page: Page, t: number) =>
  page.evaluate((time) => {
    const w = window as unknown as { __stores: { transport: { getState: () => { seek: (t: number) => void } } } };
    w.__stores.transport.getState().seek(time);
  }, t);

test('Persian and English text: create, style live, undo/redo every property', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  const inspector = page.getByTestId('clip-inspector');

  // Persian text at 1 s.
  await seek(page, 1);
  await page.getByTestId('btn-add-text').click();
  await expect(inspector).toBeVisible();
  await page.getByTestId('text-content').fill('سلام دنیا، این یک متن آزمایشی است');
  let [fa] = await texts(page);
  expect(fa).toMatchObject({ content: 'سلام دنیا، این یک متن آزمایشی است', rtl: true });

  // Style it: size, colour, font, weight, background, position.
  const size = inspector.getByRole('textbox', { name: 'Font size' });
  await size.fill('120');
  await size.press('Enter');
  await inspector.locator('input[type=color]').first().fill('#ff0000');
  await inspector.getByRole('combobox', { name: 'Font' }).selectOption('Lalezar');
  await inspector.getByRole('checkbox', { name: 'Background' }).check();
  const y = inspector.getByRole('textbox', { name: 'Vertical' });
  await y.fill('-20');
  await y.press('Enter');
  [fa] = await texts(page);
  expect(fa).toMatchObject({ fontSize: 120, color: '#ff0000', fontFamily: 'Lalezar', fontWeight: 400, bgColor: '#000000' });
  expect(fa.y).toBeCloseTo(-0.2);

  // The preview shows red text in the Lalezar font (pixels + font actually loaded).
  await seek(page, 2);
  await expect.poll(() => page.evaluate(() => document.fonts.check('400 120px Lalezar', 'سلام'))).toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
        const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
        let red = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i + 1] < 60 && d[i + 2] < 60) red++;
        return red;
      }),
    )
    .toBeGreaterThan(200);
  await page.getByTestId('preview-canvas').screenshot({ path: 'test-results/text-preview-fa.png' });

  // Undo each property in reverse order (focus elsewhere so Ctrl+Z is the app's, not the input's).
  await page.getByTestId('timeline').click({ position: { x: 5, y: 5 } });
  const undo = async () => {
    await page.keyboard.press('Control+z');
    return (await texts(page))[0];
  };
  expect((await undo()).y).toBeCloseTo(0.3);
  expect((await undo()).bgColor).toBeUndefined();
  expect((await undo()).fontFamily).toBe('Vazirmatn');
  expect((await undo()).color).toBe('#ffffff');
  expect((await undo()).fontSize).toBe(72);
  for (let i = 0; i < 5; i++) await page.keyboard.press('Control+Shift+z');
  [fa] = await texts(page);
  expect(fa).toMatchObject({ fontSize: 120, color: '#ff0000', fontFamily: 'Lalezar', bgColor: '#000000' });

  // English text at 5 s goes on the same text track and is LTR.
  await seek(page, 5);
  await page.getByTestId('btn-add-text').click();
  await page.getByTestId('text-content').fill('Hello world');
  const all = await texts(page);
  expect(all).toHaveLength(2);
  expect(all[1]).toMatchObject({ content: 'Hello world', rtl: false });
  await seek(page, 6);
  await page.waitForTimeout(300);
  await page.getByTestId('preview-canvas').screenshot({ path: 'test-results/text-preview-en.png' });

  // Survives reload.
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
  await page.reload();
  await expect.poll(() => texts(page).then((x) => x.length)).toBe(2);
});
