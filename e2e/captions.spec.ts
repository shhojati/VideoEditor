// Animated word captions: the style is picked in the inspector, word timings drive what is drawn,
// and the export worker draws the same frames as the preview.
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker);
  await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
});

type Draft = {
  subtitleTracks: { style: Record<string, unknown>; cues: { words?: { text: string; start: number; end: number }[] }[] }[];
};
type W = {
  __stores: {
    project: { getState: () => { edit: (label: string, recipe: (d: Draft) => void) => void } };
    transport: { getState: () => { seek: (t: number) => void } };
  };
  __playback: { render: (t: number) => void };
};

async function importSolid(page: Page, name: string, color: string) {
  const base64 = await page.evaluate(async (color) => {
    const depPath = '/node_modules/.vite/deps/mediabunny.js';
    const mb: typeof import('mediabunny') = await import(/* @vite-ignore */ depPath);
    const canvas = new OffscreenCanvas(640, 360);
    const ctx = canvas.getContext('2d')!;
    const output = new mb.Output({ format: new mb.Mp4OutputFormat({ fastStart: 'in-memory' }), target: new mb.BufferTarget() });
    const video = new mb.CanvasSource(canvas, { codec: 'avc', bitrate: mb.QUALITY_HIGH });
    output.addVideoTrack(video, { frameRate: 30 });
    await output.start();
    for (let n = 0; n < 90; n++) {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 640, 360);
      await video.add(n / 30, 1 / 30);
    }
    await output.finalize();
    const bytes = new Uint8Array(output.target.buffer!);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }, color);
  await page.getByTestId('media-input').setInputFiles({ name, mimeType: 'video/mp4', buffer: Buffer.from(base64, 'base64') });
  await expect(page.locator('[data-testid=asset-card][data-status=ready]', { hasText: name })).toBeVisible({ timeout: 60_000 });
}

const centrePixel = (page: Page, t: number) =>
  page.evaluate(async (time) => {
    const w = window as unknown as W;
    w.__stores.transport.getState().seek(time);
    await new Promise((r) => setTimeout(r, 500));
    w.__playback.render(time);
    const c = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]')!;
    const v = c.getBoundingClientRect();
    const f = document.querySelector('[data-testid=preview-frame]')!.getBoundingClientRect();
    const x = Math.round(((f.left + f.width / 2 - v.left) / v.width) * c.width);
    const y = Math.round(((f.top + f.height / 2 - v.top) / v.height) * c.height);
    return Array.from(c.getContext('2d')!.getImageData(x, y, 1, 1).data.slice(0, 3));
  }, t);

test('one-word captions follow word timings; preview = export', async ({ page }) => {
  test.setTimeout(3 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await importSolid(page, 'red.mp4', '#ff0000');
  await page.locator('[data-testid=asset-card]').dragTo(page.locator('[data-testid=track][data-track-kind=video] [data-lane]'), { targetPosition: { x: 2, y: 20 } });

  await page.getByTestId('tab-subtitles').click();
  const srt = ['1', '00:00:00,000 --> 00:00:03,000', 'سلام دوستان', ''].join('\n');
  await page.getByTestId('subtitle-file-input').setInputFiles({ name: 'a.srt', mimeType: 'application/x-subrip', buffer: Buffer.from(srt) });
  await expect(page.getByTestId('cue')).toHaveCount(1);
  // Word timings as speech-to-text gives them: nothing is said during the first second.
  await page.evaluate(() =>
    (window as unknown as W).__stores.project.getState().edit('test', (d) => {
      d.subtitleTracks[0].cues[0].words = [
        { text: 'سلام', start: 1, end: 1.5 },
        { text: 'دوستان', start: 2, end: 2.6 },
      ];
    }),
  );

  // Pick the animation in the inspector.
  await page.getByTestId('cue').first().click();
  const style = page.getByTestId('subtitle-style');
  await style.getByRole('combobox', { name: 'Animation' }).selectOption('single');
  await expect(style.getByText('Spoken word size')).toBeVisible();
  // A solid green box behind the word (and green text), so the frame centre is green while a word shows.
  await page.evaluate(() =>
    (window as unknown as W).__stores.project.getState().edit('test', (d) => {
      Object.assign(d.subtitleTracks[0].style, {
        position: 'middle',
        fontSize: 120,
        color: '#00ff00',
        highlightColor: '#00ff00',
        bgColor: '#00ff00',
        bgOpacity: 1,
        strokeColor: undefined,
      });
    }),
  );

  const at = [0.5, 1.5, 2.5];
  const preview: number[][] = [];
  for (const t of at) preview.push(await centrePixel(page, t));
  expect(preview[0][0]).toBeGreaterThan(200); // red: no word yet
  expect(preview[0][1]).toBeLessThan(40);
  for (const px of preview.slice(1)) expect(px[1]).toBeGreaterThan(200); // green word box
  expect(preview[1][0]).toBeLessThan(40);

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
      for (const t of at) {
        const c = (await sink.getCanvas(t))!.canvas as OffscreenCanvas;
        out.push(Array.from((c.getContext('2d') as OffscreenCanvasRenderingContext2D).getImageData(c.width >> 1, c.height >> 1, 1, 1).data.slice(0, 3)));
      }
      return out;
    },
    { url: href, at },
  );
  console.log(JSON.stringify({ preview, exported }));
  exported.forEach((px, i) => px.forEach((v, k) => expect(Math.abs(v - preview[i][k]), `${at[i]} s channel ${k}: ${px} vs ${preview[i]}`).toBeLessThan(14)));
});
