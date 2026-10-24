import { expect, test, type Page } from '@playwright/test';

/** Builds a small H.264/AAC MP4 inside the page (same encoder as the export spike) and imports it. */
async function importGeneratedVideo(page: Page, seconds: number, name: string) {
  const base64 = await page.evaluate(async (s) => {
    // Resolved by the dev server inside the page, not by Node.
    const lib = '/spikes/export-lib.ts';
    const { exportTestVideo } = await import(/* @vite-ignore */ lib);
    const { blob } = await exportTestVideo(s, 640, 360, 30);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, seconds);
  await page.getByTestId('media-input').setInputFiles({ name, mimeType: 'video/mp4', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator(`[data-testid=asset-card][data-status=ready]`, { hasText: name })).toBeVisible();
}

const clips = (page: Page) =>
  page.getByTestId('clip').evaluateAll((els) =>
    els
      .map((el) => ({ start: Number(el.getAttribute('data-start')), duration: Number(el.getAttribute('data-duration')) }))
      .sort((a, b) => a.start - b.start),
  );

/** Pixel x (page coordinates) of a timeline time, using the lane's left edge and the zoom. */
async function xForTime(page: Page, seconds: number) {
  const lane = await page.locator('[data-testid=track][data-track-kind=video] [data-lane]').boundingBox();
  return lane!.x + seconds * 40; // default zoom: 40 px/s
}

async function drag(page: Page, from: { x: number; y: number }, dx: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx / 2, from.y, { steps: 5 });
  await page.mouse.move(from.x + dx, from.y, { steps: 5 });
  await page.mouse.up();
}

test('build, split, trim and move clips with undo and persistence', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await importGeneratedVideo(page, 6, 'clip-a.mp4');

  // Drag from the media bin onto the video track (native HTML5 drag and drop).
  const videoLane = page.locator('[data-testid=track][data-track-kind=video] [data-lane]');
  await page.locator('[data-testid=asset-card]', { hasText: 'clip-a.mp4' }).dragTo(videoLane, {
    targetPosition: { x: 2, y: 20 },
  });
  await expect(page.getByTestId('clip')).toHaveCount(1);
  let c = await clips(page);
  expect(c[0].start).toBe(0);
  expect(c[0].duration).toBeCloseTo(6, 1);

  // Split at 3 s: click the ruler there, press S.
  const ruler = await page.getByTestId('ruler').boundingBox();
  await page.mouse.click(await xForTime(page, 3), ruler!.y + 10);
  await expect(page.getByTestId('timecode')).toContainText('0:03.00');
  await page.keyboard.press('s');
  await expect(page.getByTestId('clip')).toHaveCount(2);
  c = await clips(page);
  expect(c.map((x) => x.start)).toEqual([0, 3]);
  expect(c[0].duration).toBeCloseTo(3, 2);

  // Trim the first clip's end 1 s to the left.
  const laneBox = (await videoLane.boundingBox())!;
  const y = laneBox.y + laneBox.height / 2;
  await drag(page, { x: (await xForTime(page, 3)) - 3, y }, -40);
  c = await clips(page);
  expect(c[0].duration).toBeCloseTo(2, 1);

  // Move the second clip 2 s to the right.
  await drag(page, { x: await xForTime(page, 4), y }, 80);
  c = await clips(page);
  expect(c[1].start).toBeCloseTo(5, 1);

  // Undo the move, redo it.
  await page.keyboard.press('Control+z');
  expect((await clips(page))[1].start).toBeCloseTo(3, 2);
  await page.keyboard.press('Control+Shift+z');
  expect((await clips(page))[1].start).toBeCloseTo(5, 1);

  // Everything survives a reload.
  await expect(page.getByTestId('save-status')).toHaveAttribute('data-status', 'saved');
  await page.reload();
  await expect(page.getByTestId('clip')).toHaveCount(2);
  c = await clips(page);
  expect(c[0].duration).toBeCloseTo(2, 1);
  expect(c[1].start).toBeCloseTo(5, 1);
});
