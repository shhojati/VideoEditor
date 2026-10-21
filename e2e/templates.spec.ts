// Templates: the pane shows thumbnails, a click adds the template at the playhead on new graphics
// tracks, and the export draws it like the preview (shapes, effects, text animations).
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
});

type W = {
  __stores: {
    transport: { getState: () => { seek: (t: number) => void } };
    project: { getState: () => { history: { present: { tracks: { kind: string; clips: { start: number; text?: { content: string } }[] }[] } } } };
  };
  __playback: { render: (t: number) => void };
};
const pixel = (page: Page, t: number, fx: number, fy: number) =>
  page.evaluate(
    async ({ t, fx, fy }) => {
      const w = window as unknown as W;
      w.__stores.transport.getState().seek(t);
      await new Promise((r) => setTimeout(r, 400));
      w.__playback.render(t);
      const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
      const v = c.getBoundingClientRect();
      const f = document.querySelector('[data-testid=preview-frame]')!.getBoundingClientRect();
      const x = Math.round(((f.left + f.width * fx - v.left) / v.width) * c.width);
      const y = Math.round(((f.top + f.height * fy - v.top) / v.height) * c.height);
      return Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data.slice(0, 3));
    },
    { t, fx, fy },
  );

test('add a template from the pane; preview = export', async ({ page }) => {
  test.setTimeout(2 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByTestId('tab-templates').click();
  const item = page.locator('[data-testid=template-item][data-template=intro-welcome]');
  await expect(item.locator('img')).toBeVisible({ timeout: 20_000 }); // its thumbnail

  await page.evaluate(() => (window as unknown as W).__stores.transport.getState().seek(0));
  await item.click();
  const tracks = await page.evaluate(() => (window as unknown as W).__stores.project.getState().history.present.tracks.filter((t) => t.clips.length));
  expect(tracks.map((t) => t.kind)).toEqual(['text', 'text']);
  expect(tracks[1].clips[0].text?.content).toBe('Welcome');

  // The purple panel fills the frame; the text animation has settled by 1.5 s.
  const at: [number, number, number][] = [
    [1.5, 0.1, 0.1],
    [1.5, 0.5, 0.5],
  ];
  const preview: number[][] = [];
  for (const [t, fx, fy] of at) preview.push(await pixel(page, t, fx, fy));
  expect(preview[0]).toEqual([124, 58, 237]);

  await page.getByTestId('open-export').click();
  await page.getByTestId('export-dialog').getByRole('radio', { name: '720p' }).click();
  await page.getByTestId('export-start').click();
  await expect(page.getByTestId('export-done')).toBeVisible({ timeout: 90_000 });
  const href = await page.getByTestId('export-download').getAttribute('href');
  const exported = await page.evaluate(
    async ({ url, at }) => {
      const depPath = '/node_modules/.vite/deps/mediabunny.js';
      const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
      const input = new mb.Input({ source: new mb.BlobSource(await (await fetch(url!)).blob()), formats: mb.ALL_FORMATS });
      const sink = new mb.CanvasSink((await input.getPrimaryVideoTrack())!, { poolSize: 1 });
      const out: number[][] = [];
      for (const [t, fx, fy] of at) {
        const c = (await sink.getCanvas(t))!.canvas as OffscreenCanvas;
        out.push(Array.from((c.getContext('2d') as OffscreenCanvasRenderingContext2D).getImageData(Math.round(c.width * fx), Math.round(c.height * fy), 1, 1).data.slice(0, 3)));
      }
      return out;
    },
    { url: href, at },
  );
  console.log(JSON.stringify({ preview, exported }));
  exported.forEach((px, i) => px.forEach((v, k) => expect(Math.abs(v - preview[i][k]), `point ${i} channel ${k}: ${px} vs ${preview[i]}`).toBeLessThan(16)));
});
