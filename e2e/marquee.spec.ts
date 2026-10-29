// Rubber-band (marquee) clip selection on the timeline.
import { expect, test, type Page } from '@playwright/test';

type P = { tracks: { id: string; clips: { id: string; start: number }[] }[] };
type W = {
  __stores: {
    project: { getState: () => { history: { present: P } | null } };
    transport: { getState: () => { seek: (t: number) => void } };
  };
};

const seek = (page: Page, t: number) => page.evaluate((time) => (window as unknown as W).__stores.transport.getState().seek(time), t);

/** Clip ids per track, in model order (bottom track first). */
const layout = (page: Page) =>
  page.evaluate(() =>
    ((window as unknown as W).__stores.project.getState().history?.present.tracks ?? []).map((t) => ({ id: t.id, clips: t.clips.map((c) => c.id) })),
  );

const selected = (page: Page) =>
  page.locator('[data-testid=clip][data-selected=true]').evaluateAll((els) => els.map((el) => el.getAttribute('data-clip-id')).sort());

/** Page coordinates of time `seconds` on the lane of track `trackId`, at the given fraction of its height. */
async function at(page: Page, trackId: string, seconds: number, fy = 0.5) {
  const box = (await page.locator(`[data-lane][data-track-id="${trackId}"]`).boundingBox())!;
  return { x: box.x + seconds * 40, y: box.y + box.height * fy }; // default zoom: 40 px/s
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, modifier?: 'Shift') {
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}

test('drag a box over clips on two tracks, Shift-drag adds, a click clears', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();

  // Two overlapping texts at 0 s land on two graphics tracks; a third at 20 s.
  await page.getByTestId('btn-add-text').click();
  await page.getByTestId('btn-add-text').click();
  await seek(page, 20);
  await page.getByTestId('btn-add-text').click();
  await seek(page, 0);
  const tracks = (await layout(page)).filter((t) => t.clips.length);
  expect(tracks.length).toBeGreaterThanOrEqual(2);
  const all = tracks.flatMap((t) => t.clips);
  expect(all).toHaveLength(3);
  // Displayed top first: the model's last track is the top row.
  const [top, below] = [tracks.at(-1)!, tracks.at(-2)!];
  const lateId = (await page.evaluate(() =>
    (window as unknown as W).__stores.project.getState().history!.present.tracks.flatMap((t) => t.clips).find((c) => c.start >= 19)!.id,
  ))!;
  const early = all.filter((id) => id !== lateId);

  // Start on empty lane background after the clips, drag back over both rows to 1 s.
  await page.keyboard.press('Escape');
  await drag(page, await at(page, top.id, 12, 0.3), await at(page, below.id, 1, 0.7));
  await expect(page.getByTestId('marquee')).toHaveCount(0);
  expect(await selected(page)).toEqual([...early].sort());

  // Shift-drag a box around the late clip adds it to the selection.
  const lateTrack = tracks.find((t) => t.clips.includes(lateId))!;
  await drag(page, await at(page, lateTrack.id, 15, 0.2), await at(page, lateTrack.id, 22, 0.8), 'Shift');
  expect(await selected(page)).toEqual([...all].sort());

  // Esc during a drag puts the earlier selection back.
  const from = await at(page, top.id, 15, 0.3);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 60, from.y + 10, { steps: 4 });
  await expect(page.getByTestId('marquee')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.getByTestId('marquee')).toHaveCount(0);
  expect(await selected(page)).toEqual([...all].sort());

  // A click on empty lane background clears the selection.
  const empty = await at(page, top.id, 12);
  await page.mouse.click(empty.x, empty.y);
  expect(await selected(page)).toEqual([]);
});
