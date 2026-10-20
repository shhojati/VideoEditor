import { expect, test, type Page } from '@playwright/test';

const RLM = String.fromCharCode(0x200f);

type CueState = { start: number; end: number; text: string; flag?: string };
const cues = (page: Page) =>
  page.evaluate(() => {
    type P = { subtitleTracks: { cues: CueState[] }[] };
    const w = window as unknown as { __stores?: { project: { getState: () => { history: { present: P } | null } } } };
    return w.__stores?.project.getState().history?.present.subtitleTracks.at(-1)?.cues ?? [];
  });

/** Clicks the export button and returns the downloaded file's name and raw bytes as text. */
async function exportSrt(page: Page) {
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('export-srt').click()]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return { name: download.suggestedFilename(), text: Buffer.concat(chunks).toString('utf8') };
}

test('import SRT, edit cues on the list and timeline, export SRT', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByTestId('tab-subtitles').click();

  const srt = [
    '1', '00:00:01,000 --> 00:00:03,000', `${RLM}سلام دنیا، خوش آمدید.`, '',
    '2', '00:00:04,000 --> 00:00:06,500', '<i>این یک آزمایش است</i>', '',
    'broken block', '',
    '3', '00:00:08,000 --> 00:00:09,000', 'نسخه 2', '',
  ].join('\r\n');
  await page.getByTestId('subtitle-file-input').setInputFiles({ name: 'test.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
  await expect(page.getByRole('status')).toContainText('Imported 3 subtitles (1 invalid');
  await expect(page.getByTestId('cue')).toHaveCount(3);
  expect((await cues(page)).map((c) => c.text)).toEqual(['سلام دنیا، خوش آمدید.', 'این یک آزمایش است', 'نسخه 2']);

  // Edit text in the list.
  await page.getByTestId('cue-text').nth(1).fill('این یک آزمایش ساده است');
  // Move cue 3 on the timeline 1 s to the right (40 px at the default zoom).
  const third = page.locator('[data-testid=cue]').nth(2);
  const box = (await third.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2, { steps: 4 });
  await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2, { steps: 4 });
  await page.mouse.up();
  let c = await cues(page);
  expect(c[2].start).toBeCloseTo(9, 1);
  // Split cue 1 at 2 s with S (it is selected after clicking it).
  await page.locator('[data-testid=cue]').first().click();
  await page.evaluate(() => (window as unknown as { __stores: { transport: { getState: () => { seek: (t: number) => void } } } }).__stores.transport.getState().seek(2));
  await page.keyboard.press('s');
  c = await cues(page);
  expect(c).toHaveLength(4);
  expect(c.slice(0, 2).map((x) => x.text)).toEqual(['سلام دنیا،', 'خوش آمدید.']);
  // Undo the split, redo it.
  await page.keyboard.press('Control+z');
  expect(await cues(page)).toHaveLength(3);
  await page.keyboard.press('Control+y');
  expect(await cues(page)).toHaveLength(4);

  // Persian digits style applies to the exported file too.
  await page.locator('[data-testid=cue]').first().click();
  await page.getByTestId('subtitle-style').getByRole('radio', { name: '۱۲۳' }).click();

  const out = await exportSrt(page);
  expect(out.name).toMatch(/\.fa\.srt$/);
  expect(out.text.charCodeAt(0)).toBe(0xfeff); // BOM
  expect(out.text).toContain('\r\n');
  const blocks = out.text.slice(1).trim().split('\r\n\r\n');
  expect(blocks).toHaveLength(4);
  expect(blocks[0]).toBe(`1\r\n00:00:01,000 --> 00:00:02,000\r\n${RLM}سلام دنیا،`);
  expect(blocks[3]).toBe(`4\r\n00:00:09,000 --> 00:00:10,000\r\n${RLM}نسخه ۲`);
});

test('edit a cue from the inspector and by double-clicking it on the timeline', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByTestId('tab-subtitles').click();
  const srt = ['1', '00:00:01,000 --> 00:00:03,000', 'first', '', '2', '00:00:04,000 --> 00:00:06,000', 'second', ''].join('\n');
  await page.getByTestId('subtitle-file-input').setInputFiles({ name: 'a.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
  await expect(page.getByTestId('cue')).toHaveCount(2);

  // Selecting a cue on the timeline shows its text in the inspector.
  await page.getByTestId('cue').first().click();
  const field = page.getByTestId('inspector-cue-text');
  await expect(field).toHaveValue('first');
  await field.fill('first, fixed');
  expect((await cues(page))[0].text).toBe('first, fixed');
  await expect(page.getByTestId('cue').first()).toContainText('first, fixed');

  // Double-clicking a cue opens the Subtitles tab with its text focused (from another tab too).
  await page.getByTestId('tab-media').click();
  await page.getByTestId('cue').nth(1).dblclick();
  const box = page.getByTestId('cue-text').nth(1);
  await expect(box).toBeFocused();
  await page.keyboard.type('second, fixed');
  expect((await cues(page))[1].text).toBe('second, fixed');
});

// Real speech-to-text with the tiny model on 70 s of Persian speech. Needs the model files in
// public/models and takes a few minutes, so it only runs with STT_E2E=1.
test('auto subtitles from Persian speech (STT_E2E=1)', async ({ page }) => {
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
  await page.locator('[data-testid=asset-card]').dragTo(page.locator('[data-testid=track][data-track-kind=video] [data-lane]'), { targetPosition: { x: 2, y: 20 } });
  await page.getByTestId('tab-subtitles').click();
  await page.getByTestId('auto-subtitles').getByRole('button').first().click();
  await page.getByTestId('stt-model').selectOption('tiny');
  page.on('console', (m) => m.type() === 'error' && console.log('[page]', m.text()));
  page.on('load', () => console.log('[page] (re)loaded'));
  const status = setInterval(() => {
    void page.getByTestId('auto-subtitles').innerText().then((t) => console.log('[stt]', t.replace(/\s+/g, ' ').slice(0, 160)), () => {});
  }, 30_000);
  await page.getByTestId('stt-start').click();
  // Finish = done message or an error (fail fast and show it).
  const outcome = page.getByTestId('stt-done').or(page.getByTestId('auto-subtitles').getByRole('alert'));
  await expect(outcome).toBeVisible({ timeout: 14 * 60_000 });
  clearInterval(status);
  await expect(page.getByTestId('stt-done'), await outcome.innerText()).toBeVisible();
  const c = await cues(page);
  expect(c.length).toBeGreaterThan(5);
  expect(c.every((x) => x.end > x.start)).toBe(true);
  // Mostly Persian script.
  expect(c.filter((x) => /[؀-ۿ]/.test(x.text)).length).toBeGreaterThan(c.length * 0.8);
});
