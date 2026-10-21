import { afterEach, describe, expect, it, vi } from 'vitest';
import { frameIndexAt } from '../engine/decode/animatedImage';
import { displayName, libraryUrl, LibraryUnavailable, listLibrary } from './library';

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

afterEach(() => vi.unstubAllGlobals());

describe('server library', () => {
  it('lists usable files with one level of categories, sorted, from nginx JSON listings', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === '/library/stickers/')
        return json([
          { name: 'Zebra_face.png', type: 'file', size: 10 },
          { name: '.hidden.png', type: 'file' },
          { name: 'readme.txt', type: 'file' },
          { name: 'animals', type: 'directory' },
          { name: 'آیکون', type: 'directory' },
        ]);
      if (url === '/library/stickers/animals/') return json([{ name: 'cat-2.GIF', type: 'file', size: 5 }, { name: 'cat-10.gif', type: 'file' }]);
      if (url === '/library/stickers/%D8%A2%DB%8C%DA%A9%D9%88%D9%86/') return json([{ name: 'قلب.png', type: 'file' }]);
      return new Response('', { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const items = await listLibrary('stickers');
    expect(items.map((i) => [i.category, i.name, i.path])).toEqual([
      ['', 'Zebra face', 'Zebra_face.png'],
      ['animals', 'cat 2', 'animals/cat-2.GIF'],
      ['animals', 'cat 10', 'animals/cat-10.gif'], // numeric order
      ['آیکون', 'قلب', 'آیکون/قلب.png'],
    ]);
    expect(items[3].url).toBe('/library/stickers/%D8%A2%DB%8C%DA%A9%D9%88%D9%86/%D9%82%D9%84%D8%A8.png');
  });

  it('reports a missing or unlisted folder as unavailable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
    await expect(listLibrary('sounds')).rejects.toBeInstanceOf(LibraryUnavailable);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>index</html>', { headers: { 'Content-Type': 'text/html' } })));
    await expect(listLibrary('sounds')).rejects.toBeInstanceOf(LibraryUnavailable);
  });

  it('names and urls', () => {
    expect(displayName('light-leak_01.mp4')).toBe('light leak 01');
    expect(libraryUrl('sounds', 'a b/c#d.mp3')).toBe('/library/sounds/a%20b/c%23d.mp3');
  });

  it('animated images loop and pick the frame by start time', () => {
    const starts = [0, 0.1, 0.3];
    expect([0, 0.05, 0.1, 0.29, 0.3, 0.39, 0.4, 0.45].map((t) => frameIndexAt(starts, 0.4, t))).toEqual([0, 0, 1, 1, 2, 2, 0, 0]);
    expect(frameIndexAt(starts, 0.4, -0.05)).toBe(2);
  });
});
