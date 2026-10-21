// Minimal ZIP container, "stored" (no compression): media is already compressed, and storing keeps
// writing and reading streaming and fast. ZIP64 fields are used when sizes or offsets pass 4 GB.
// Written files open in any zip tool; the reader handles what the writer produces (and other
// stored, unencrypted archives).

const LOCAL = 0x04034b50;
const CENTRAL = 0x02014b50;
const END = 0x06054b50;
const END64 = 0x06064b50;
const LOCATOR64 = 0x07064b50;
const MAX32 = 0xffffffff;
const UTF8_FLAG = 0x0800;

let crcTable: Uint32Array | null = null;

export function crc32(data: Uint8Array, crc = 0): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = ~crc >>> 0;
  for (let i = 0; i < data.length; i++) c = crcTable[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

async function crcOfBlob(blob: Blob, onBytes?: (n: number) => void) {
  let crc = 0;
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return crc;
    crc = crc32(value, crc);
    onBytes?.(value.byteLength);
  }
}

class Bytes {
  private view: DataView;
  readonly buf: Uint8Array;
  private at = 0;
  constructor(size: number) {
    this.buf = new Uint8Array(size);
    this.view = new DataView(this.buf.buffer);
  }
  u16(v: number) {
    this.view.setUint16(this.at, v, true);
    this.at += 2;
    return this;
  }
  u32(v: number) {
    this.view.setUint32(this.at, v >>> 0, true);
    this.at += 4;
    return this;
  }
  u64(v: number) {
    this.view.setBigUint64(this.at, BigInt(v), true);
    this.at += 8;
    return this;
  }
  bytes(b: Uint8Array) {
    this.buf.set(b, this.at);
    this.at += b.length;
    return this;
  }
}

function dosDateTime(d: Date) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = (Math.max(0, d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

interface Entry {
  name: Uint8Array;
  crc: number;
  size: number;
  offset: number;
}

/** Sink for the archive bytes, in order. Blobs may be passed through without being read. */
export type ZipSink = (part: Blob | Uint8Array) => Promise<void> | void;

export class ZipWriter {
  private offset = 0;
  private readonly entries: Entry[] = [];
  private readonly stamp = dosDateTime(new Date());

  constructor(private readonly sink: ZipSink) {}

  private async put(part: Blob | Uint8Array) {
    await this.sink(part);
    this.offset += part instanceof Blob ? part.size : part.byteLength;
  }

  /**
   * Add a file. Its data is read once for the checksum and then handed to the sink as is.
   * `onBytes` reports checksum progress.
   */
  async add(name: string, data: Blob | Uint8Array, onBytes?: (n: number) => void) {
    const blob = data instanceof Blob ? data : new Blob([data as Uint8Array<ArrayBuffer>]);
    const crc = data instanceof Blob ? await crcOfBlob(data, onBytes) : crc32(data);
    const nameBytes = new TextEncoder().encode(name);
    const size = blob.size;
    const big = size >= MAX32;
    const header = new Bytes(30 + nameBytes.length + (big ? 20 : 0))
      .u32(LOCAL)
      .u16(big ? 45 : 20)
      .u16(UTF8_FLAG)
      .u16(0) // stored
      .u16(this.stamp.time)
      .u16(this.stamp.date)
      .u32(crc)
      .u32(big ? MAX32 : size)
      .u32(big ? MAX32 : size)
      .u16(nameBytes.length)
      .u16(big ? 20 : 0)
      .bytes(nameBytes);
    if (big) header.u16(0x0001).u16(16).u64(size).u64(size);
    this.entries.push({ name: nameBytes, crc, size, offset: this.offset });
    await this.put(header.buf);
    await this.put(blob);
  }

  /** Write the central directory. Returns the archive size. */
  async finish(): Promise<number> {
    const cdStart = this.offset;
    for (const e of this.entries) {
      const bigSize = e.size >= MAX32;
      const bigOffset = e.offset >= MAX32;
      const extraLen = bigSize || bigOffset ? 4 + (bigSize ? 16 : 0) + (bigOffset ? 8 : 0) : 0;
      const rec = new Bytes(46 + e.name.length + extraLen)
        .u32(CENTRAL)
        .u16(45) // made by
        .u16(extraLen ? 45 : 20)
        .u16(UTF8_FLAG)
        .u16(0)
        .u16(this.stamp.time)
        .u16(this.stamp.date)
        .u32(e.crc)
        .u32(bigSize ? MAX32 : e.size)
        .u32(bigSize ? MAX32 : e.size)
        .u16(e.name.length)
        .u16(extraLen)
        .u16(0) // comment
        .u16(0) // disk
        .u16(0) // internal attributes
        .u32(0) // external attributes
        .u32(bigOffset ? MAX32 : e.offset)
        .bytes(e.name);
      if (extraLen) {
        rec.u16(0x0001).u16(extraLen - 4);
        if (bigSize) rec.u64(e.size).u64(e.size);
        if (bigOffset) rec.u64(e.offset);
      }
      await this.put(rec.buf);
    }
    const cdSize = this.offset - cdStart;
    const count = this.entries.length;
    if (count >= 0xffff || cdStart >= MAX32 || cdSize >= MAX32) {
      const end64At = this.offset;
      await this.put(
        new Bytes(56).u32(END64).u64(44).u16(45).u16(45).u32(0).u32(0).u64(count).u64(count).u64(cdSize).u64(cdStart).buf,
      );
      await this.put(new Bytes(20).u32(LOCATOR64).u32(0).u64(end64At).u32(1).buf);
    }
    await this.put(
      new Bytes(22)
        .u32(END)
        .u16(0)
        .u16(0)
        .u16(Math.min(count, 0xffff))
        .u16(Math.min(count, 0xffff))
        .u32(Math.min(cdSize, MAX32))
        .u32(Math.min(cdStart, MAX32))
        .u16(0).buf,
    );
    return this.offset;
  }
}

export interface ZipEntry {
  name: string;
  size: number;
  crc: number;
  /** The entry's data (a slice of the archive; nothing is read until it is used). */
  blob: Blob;
}

export class ZipFormatError extends Error {}

const readView = async (blob: Blob, start: number, len: number) => new DataView(await blob.slice(start, start + len).arrayBuffer());
const u64 = (v: DataView, at: number) => Number(v.getBigUint64(at, true));

/** List the entries of a stored ZIP archive. */
export async function readZip(file: Blob): Promise<ZipEntry[]> {
  // The end record is in the last 22 bytes plus at most a 64 KB comment.
  const tailLen = Math.min(file.size, 22 + 0xffff);
  const tail = await readView(file, file.size - tailLen, tailLen);
  let endAt = -1;
  for (let i = tailLen - 22; i >= 0; i--)
    if (tail.getUint32(i, true) === END) {
      endAt = i;
      break;
    }
  if (endAt < 0) throw new ZipFormatError('Not a zip archive');
  let count = tail.getUint16(endAt + 10, true);
  let cdSize = tail.getUint32(endAt + 12, true);
  let cdStart = tail.getUint32(endAt + 16, true);
  if (count === 0xffff || cdSize === MAX32 || cdStart === MAX32) {
    const locAt = file.size - tailLen + endAt - 20;
    const loc = await readView(file, locAt, 20);
    if (loc.getUint32(0, true) !== LOCATOR64) throw new ZipFormatError('Missing ZIP64 locator');
    const end64 = await readView(file, u64(loc, 8), 56);
    if (end64.getUint32(0, true) !== END64) throw new ZipFormatError('Bad ZIP64 end record');
    count = u64(end64, 32);
    cdSize = u64(end64, 40);
    cdStart = u64(end64, 48);
  }
  const cd = await readView(file, cdStart, cdSize);
  const decoder = new TextDecoder();
  const out: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < count; i++) {
    if (cd.getUint32(at, true) !== CENTRAL) throw new ZipFormatError('Bad central directory');
    const method = cd.getUint16(at + 10, true);
    const crc = cd.getUint32(at + 16, true);
    let size = cd.getUint32(at + 24, true);
    let compressed = cd.getUint32(at + 20, true);
    const nameLen = cd.getUint16(at + 28, true);
    const extraLen = cd.getUint16(at + 30, true);
    const commentLen = cd.getUint16(at + 32, true);
    let offset = cd.getUint32(at + 42, true);
    const name = decoder.decode(new Uint8Array(cd.buffer, cd.byteOffset + at + 46, nameLen));
    // ZIP64 extra: only the fields that were 0xFFFFFFFF, in this order.
    for (let x = at + 46 + nameLen; x < at + 46 + nameLen + extraLen; ) {
      const id = cd.getUint16(x, true);
      const len = cd.getUint16(x + 2, true);
      if (id === 0x0001) {
        let f = x + 4;
        if (size === MAX32) {
          size = u64(cd, f);
          f += 8;
        }
        if (compressed === MAX32) {
          compressed = u64(cd, f);
          f += 8;
        }
        if (offset === MAX32) offset = u64(cd, f);
      }
      x += 4 + len;
    }
    if (method !== 0 || compressed !== size) throw new ZipFormatError(`Compressed entry not supported: ${name}`);
    const local = await readView(file, offset, 30);
    if (local.getUint32(0, true) !== LOCAL) throw new ZipFormatError(`Bad local header: ${name}`);
    const dataStart = offset + 30 + local.getUint16(26, true) + local.getUint16(28, true);
    out.push({ name, size, crc, blob: file.slice(dataStart, dataStart + size) });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}
