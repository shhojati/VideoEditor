// Text-based editing: select words in the transcript and delete them (every track is cut and the
// gap closes); find and remove pauses. Real transcription is in the STT_E2E run.
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
});

type C = { id: string; start: number; duration: number; assetId?: string; transcript?: unknown };
type P = { assets: Record<string, { id: string; name: string }>; tracks: { id: string; kind: string; clips: C[] }[] };
type W = { __stores: { project: { getState: () => { history: { present: P }; edit: (l: string, r: (d: P) => void) => void } } } };
const state = (page: Page) => page.evaluate(() => (window as unknown as W).__stores.project.getState().history.present);
/** Where an asset's last clip ends (a cut splits clips). */
const endOf = (p: P, name: string) => {
  const id = Object.values(p.assets).find((a) => a.name === name)!.id;
  return Math.max(...p.tracks.flatMap((t) => t.clips).filter((c) => c.assetId === id).map((c) => c.start + c.duration));
};

async function importTone(page: Page, name: string, seconds: number) {
  const base64 = await page.evaluate(async (seconds) => {
    const lib = '/spikes/export-lib.ts';
    const m = await import(/* @vite-ignore */ lib);
    const bytes = new Uint8Array(await (await m.exportTestVideo(seconds, 320, 180, 30)).blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, seconds);
  await page.getByTestId('media-input').setInputFiles({ name, mimeType: 'video/mp4', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]', { hasText: name })).toBeVisible({ timeout: 60_000 });
}

test('cut words from the transcript; find and remove pauses', async ({ page }) => {
  test.setTimeout(2 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await importTone(page, 'talk.mp4', 4);
  await importTone(page, 'music.mp4', 6);
  // The talk on the video track, the music under it on a track of its own; a known transcript.
  await page.evaluate(async () => {
    const lib = '/src/features/timeline/interactions.ts';
    const { placeAssetAt } = await import(/* @vite-ignore */ lib);
    const store = (window as unknown as W).__stores.project;
    const get = () => store.getState().history.present;
    const id = (name: string) => Object.values(get().assets).find((a) => a.name === name)!.id;
    placeAssetAt(id('talk.mp4'), get().tracks.find((t) => t.kind === 'video')!.id, 0);
    placeAssetAt(id('music.mp4'), null, 0);
    store.getState().edit('test', (d) => {
      const talk = d.tracks.flatMap((t) => t.clips).find((c) => c.assetId === id('talk.mp4'))!;
      talk.transcript = {
        language: 'en',
        rtl: false,
        words: [
          { text: 'Hello', s: 0.2, e: 0.6 },
          { text: 'um', s: 0.8, e: 1.1 },
          { text: 'world', s: 1.2, e: 1.6 },
          { text: 'again.', s: 3.0, e: 3.4 },
        ],
      };
    });
  });
  const before = await state(page);
  const [talk0, music0] = [endOf(before, 'talk.mp4'), endOf(before, 'music.mp4')];
  await page.getByTestId('tab-subtitles').click();
  await page.getByTestId('tab-transcript').click();
  const text = page.getByTestId('transcript-text');
  await expect(text.locator('[data-word]')).toHaveCount(4);
  await expect(text.locator('[data-word="0:1"]')).toHaveClass(/text-amber-300/); // "um" is a filler

  // Select "um world" and press Delete: 0.8 → 1.7 s goes (the long pause after it stays).
  await page.evaluate(() => {
    const a = document.querySelector('[data-word="0:1"]')!;
    const b = document.querySelector('[data-word="0:2"]')!;
    const r = document.createRange();
    r.setStart(a.firstChild!, 0);
    r.setEnd(b.firstChild!, b.textContent!.length);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(r);
  });
  await text.focus();
  await page.keyboard.press('Delete');
  let p = await state(page);
  expect(endOf(p, 'talk.mp4')).toBeCloseTo(talk0 - 0.9, 3);
  expect(endOf(p, 'music.mp4')).toBeCloseTo(music0 - 0.9, 3); // the music is cut too, in sync
  await expect(text.locator('[data-word]')).toHaveCount(2);

  // Pauses: the one before "again." and the end; remove them.
  await page.getByTestId('find-removals').click();
  const review = page.getByTestId('removal-review');
  await expect(review.locator('input[type=checkbox]')).toHaveCount(2);
  await page.getByTestId('remove-all').click();
  p = await state(page);
  expect(endOf(p, 'talk.mp4')).toBeLessThan(2);

  // Undo brings the pauses back.
  await page.keyboard.press('Control+z');
  p = await state(page);
  expect(endOf(p, 'talk.mp4')).toBeCloseTo(talk0 - 0.9, 3);
});

test('transcribe a Persian clip for text editing (STT_E2E=1)', async ({ page }) => {
  test.skip(!process.env.STT_E2E, 'set STT_E2E=1 to run speech-to-text end to end');
  test.setTimeout(15 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  const base64 = await page.evaluate(async () => {
    const lib = '/spikes/persian-video.ts';
    const { makePersianTestVideo } = await import(/* @vite-ignore */ lib);
    const { blob } = await makePersianTestVideo(1);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  });
  await page.getByTestId('media-input').setInputFiles({ name: 'fa.mp4', mimeType: 'video/mp4', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]')).toBeVisible({ timeout: 60_000 });
  await page.getByTestId('asset-add').click();
  await page.locator('[data-testid=clip]').first().click({ position: { x: 20, y: 10 } });
  await page.getByTestId('tab-subtitles').click();
  await page.getByTestId('tab-transcript').click();
  await page.getByTestId('transcribe').click();
  await expect(page.getByTestId('transcript-clip')).toBeVisible({ timeout: 14 * 60_000 });
  const words = await page.getByTestId('transcript-text').locator('[data-word]').count();
  console.log('[transcript] words:', words);
  expect(words).toBeGreaterThan(30);
});
