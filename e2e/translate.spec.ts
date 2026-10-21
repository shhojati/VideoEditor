// English → Persian subtitle translation with the real model. Opt-in (TRANSLATE_E2E=1): needs
// public/models/Xenova/m2m100_418M (scripts/fetch-models.mjs translate).
import { expect, test } from '@playwright/test';

test('translate an English subtitle track to Persian (TRANSLATE_E2E=1)', async ({ page }) => {
  test.skip(!process.env.TRANSLATE_E2E, 'set TRANSLATE_E2E=1 to run the translation model');
  test.setTimeout(10 * 60_000);
  await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByTestId('tab-subtitles').click();
  const srt = [
    '1', '00:00:01,000 --> 00:00:03,000', 'Hello, my friends.', '',
    '2', '00:00:04,000 --> 00:00:06,500', 'Today we will talk about video editing.', '',
    '3', '00:00:07,000 --> 00:00:09,000', 'Thank you for watching.', '',
  ].join('\n');
  await page.getByTestId('subtitle-file-input').setInputFiles({ name: 'talk.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
  await expect(page.getByTestId('cue')).toHaveCount(3);
  // English text: the track is English, so the translate box shows.
  await expect(page.getByTestId('translate-box')).toBeVisible();
  await page.getByTestId('translate-start').click();
  // When done, the panel switches to the new Persian track.
  await expect(page.getByRole('combobox', { name: 'Subtitle track' }).locator('option')).toHaveCount(2, { timeout: 9 * 60_000 });
  const fa = await page.evaluate(() => {
    type S = { language: string; rtl: boolean; cues: { start: number; end: number; text: string }[] };
    const w = window as unknown as { __stores: { project: { getState: () => { history: { present: { subtitleTracks: S[] } } } } } };
    return w.__stores.project.getState().history.present.subtitleTracks.at(-1)!;
  });
  console.log('[translate]', JSON.stringify(fa.cues.map((c) => c.text)));
  expect(fa.language).toBe('fa');
  expect(fa.rtl).toBe(true);
  expect(fa.cues.map((c) => [c.start, c.end])).toEqual([[1, 3], [4, 6.5], [7, 9]]);
  // Persian script in every cue.
  for (const c of fa.cues) expect(c.text).toMatch(/[؀-ۿ]{3}/);
});
