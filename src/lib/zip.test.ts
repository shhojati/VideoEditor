// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { crc32, readZip, ZipWriter } from './zip';

const enc = new TextEncoder();

async function build(files: [string, Blob | Uint8Array][]) {
  const parts: (Blob | Uint8Array)[] = [];
  const zip = new ZipWriter((p) => void parts.push(p));
  for (const [name, data] of files) await zip.add(name, data);
  const size = await zip.finish();
  const blob = new Blob(parts as BlobPart[]);
  expect(blob.size).toBe(size);
  return blob;
}

describe('zip', () => {
  it('computes the standard CRC-32', () => {
    expect(crc32(enc.encode('123456789'))).toBe(0xcbf43926);
    // Incremental = one shot.
    expect(crc32(enc.encode('6789'), crc32(enc.encode('12345')))).toBe(0xcbf43926);
  });

  it('round-trips stored entries with UTF-8 names', async () => {
    const media = new Uint8Array(70_000).map((_, i) => i * 7);
    const blob = await build([
      ['project.json', enc.encode('{"a":1}')],
      ['media/۱-ویدیو.mp4', new Blob([media])],
      ['empty', new Uint8Array(0)],
    ]);
    const entries = await readZip(blob);
    expect(entries.map((e) => [e.name, e.size])).toEqual([
      ['project.json', 7],
      ['media/۱-ویدیو.mp4', 70_000],
      ['empty', 0],
    ]);
    expect(await entries[0].blob.text()).toBe('{"a":1}');
    const back = new Uint8Array(await entries[1].blob.arrayBuffer());
    expect(back).toEqual(media);
    expect(entries[1].crc).toBe(crc32(media));
  });

  it('writes a file other tools can read: local header signature, stored, sizes', async () => {
    const blob = await build([['a.txt', enc.encode('hello')]]);
    const v = new DataView(await blob.arrayBuffer());
    expect(v.getUint32(0, true)).toBe(0x04034b50);
    expect(v.getUint16(8, true)).toBe(0); // stored
    expect(v.getUint32(14, true)).toBe(crc32(enc.encode('hello')));
    expect(v.getUint32(18, true)).toBe(5);
  });

  it('rejects files that are not archives', async () => {
    await expect(readZip(new Blob(['just text, no zip here']))).rejects.toThrow(/Not a zip/);
  });
});
