// Beats and markers: detect a music clip's tempo, cut photos to the beat, add and remove markers.
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('onboarding-hidden', '1'));
});

/** 16-bit mono WAV at 48 kHz: decaying noise "kicks" at 120 BPM from 0.25 s over a quiet bed. */
function clickTrack(seconds: number): Buffer {
  const rate = 48_000;
  const n = seconds * rate;
  const x = new Float32Array(n);
  let s = 5;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x7fffffff) * 2 - 1;
  };
  for (let i = 0; i < n; i++) x[i] = rnd() * 0.01;
  for (let t = 0.25; t < seconds; t += 0.5) {
    const at = Math.round(t * rate);
    for (let i = 0; i < rate * 0.08 && at + i < n; i++) x[at + i] += rnd() * 0.8 * Math.exp(-i / (rate * 0.015));
  }
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, x[i])) * 32767), 44 + i * 2);
  return buf;
}

async function png(page: Page, color: string): Promise<Buffer> {
  const base64 = await page.evaluate(async (c) => {
    const canvas = new OffscreenCanvas(320, 180);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 320, 180);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let bin = '';
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  }, color);
  return Buffer.from(base64, 'base64');
}

type State = {
  assets: Record<string, { id: string; name: string; beats?: { bpm: number; times: number[] } }>;
  tracks: { id: string; kind: string; clips: { id: string; assetId?: string; start: number; duration: number }[] }[];
  markers?: { t: number }[];
};
type W = { __stores: { project: { getState: () => { history: { present: State } } }; transport: { getState: () => { seek: (t: number) => void } } } };
const state = (page: Page) => page.evaluate(() => (window as unknown as W).__stores.project.getState().history.present);

test('detect beats, cut photos to the beat, toggle markers', async ({ page }) => {
  test.setTimeout(2 * 60_000);
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByTestId('media-input').setInputFiles([
    { name: 'music.wav', mimeType: 'audio/wav', buffer: clickTrack(10) },
    { name: 'a.png', mimeType: 'image/png', buffer: await png(page, '#ff0000') },
    { name: 'b.png', mimeType: 'image/png', buffer: await png(page, '#00ff00') },
    { name: 'c.png', mimeType: 'image/png', buffer: await png(page, '#0000ff') },
  ]);
  await expect(page.locator('[data-testid=asset-card][data-status=ready]')).toHaveCount(4, { timeout: 60_000 });

  // Music at 0 s; the photos on one video track from 0.1 s (each lands in the next free spot).
  await page.evaluate(async () => {
    const lib = '/src/features/timeline/interactions.ts';
    const { placeAssetAt } = await import(/* @vite-ignore */ lib);
    const get = () => (window as unknown as W).__stores.project.getState().history.present;
    const id = (name: string) => Object.values(get().assets).find((a) => a.name === name)!.id;
    placeAssetAt(id('music.wav'), null, 0);
    const track = get().tracks.find((t) => t.kind === 'video')!.id;
    placeAssetAt(id('a.png'), track, 0.1);
    placeAssetAt(id('b.png'), track, 2.6);
    placeAssetAt(id('c.png'), track, 5.1);
  });

  await page.locator('[data-testid=clip]', { hasText: 'music.wav' }).click({ position: { x: 20, y: 10 } });
  await page.getByTestId('detect-beats').click();
  await expect(page.getByTestId('beats-info')).toContainText('BPM', { timeout: 30_000 });
  const music = Object.values((await state(page)).assets).find((a) => a.name === 'music.wav')!;
  expect(Math.abs(music.beats!.bpm - 120)).toBeLessThan(1.5);
  expect(Math.abs(music.beats!.times.find((t) => t > 1)! - 1.25)).toBeLessThan(0.02);
  await expect(page.locator('[data-testid=clip]', { hasText: 'music.wav' }).getByTestId('beat-ticks')).toHaveAttribute('data-count', /^1[5-9]$|^20$/);

  // Cut to beat splits the selected clip at every beat inside it: a.png (0.1–2.6 s) at 0.25 … 2.25 s.
  await page.locator('[data-testid=clip]', { hasText: 'a.png' }).click({ position: { x: 10, y: 10 } });
  const before = (await state(page)).tracks.find((t) => t.kind === 'video')!.clips.map((c) => c.start);
  await page.getByTestId('cut-every').selectOption('1');
  await page.getByTestId('cut-to-beat').click();
  expect((await state(page)).tracks.find((t) => t.kind === 'video')!.clips.filter((c) => c.start < 2.6)).toHaveLength(6);
  await page.keyboard.press('Control+z');
  expect((await state(page)).tracks.find((t) => t.kind === 'video')!.clips.map((c) => c.start)).toEqual(before);

  // Select the three photos and fit them to every 2 beats (1 s each).
  await page.locator('[data-testid=clip]', { hasText: 'a.png' }).click({ position: { x: 10, y: 10 } });
  await page.locator('[data-testid=clip]', { hasText: 'b.png' }).click({ position: { x: 10, y: 10 }, modifiers: ['Shift'] });
  await page.locator('[data-testid=clip]', { hasText: 'c.png' }).click({ position: { x: 10, y: 10 }, modifiers: ['Shift'] });
  await page.getByTestId('cut-every').selectOption('2');
  await page.getByTestId('fit-to-beat').click();
  const photos = (await state(page)).tracks.find((t) => t.kind === 'video')!.clips;
  const beat = (t: number) => music.beats!.times.reduce((a, b) => (Math.abs(b - t) < Math.abs(a - t) ? b : a));
  expect(photos.map((c) => c.start)).toEqual([beat(0.25), beat(1.25), beat(2.25)].map((t) => expect.closeTo(t, 3)));
  photos.forEach((c) => expect(c.duration).toBeCloseTo(beat(c.start + 1) - c.start, 3));
  await page.keyboard.press('Control+z');
  expect((await state(page)).tracks.find((t) => t.kind === 'video')!.clips.map((c) => c.start)).toEqual(before);

  // M adds a marker at the playhead and removes it again; double-clicking it on the ruler removes it too.
  await page.getByTestId('timeline').click({ position: { x: 5, y: 5 } });
  await page.evaluate(() => (window as unknown as W).__stores.transport.getState().seek(4));
  await page.keyboard.press('m');
  expect((await state(page)).markers?.map((m) => m.t)).toEqual([4]);
  await page.keyboard.press('m');
  expect((await state(page)).markers).toEqual([]);
  await page.keyboard.press('m');
  const ruler = page.getByTestId('ruler');
  const x = await page.evaluate(async () => {
    const lib = '/src/features/timeline/timelineUi.ts';
    const { useTimelineUi } = await import(/* @vite-ignore */ lib);
    const { pps, scrollX } = useTimelineUi.getState();
    return 4 * pps - scrollX;
  });
  await ruler.dblclick({ position: { x: x + 3, y: 20 } });
  expect((await state(page)).markers).toEqual([]);
});
