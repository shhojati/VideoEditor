// Original media files live in the Origin Private File System, one file per asset: media/<assetId>.
// OPFS works on the main thread and in workers, survives reloads, and lets workers stream the file.

const MEDIA_DIR = 'media';

export const mediaPathFor = (assetId: string) => `${MEDIA_DIR}/${assetId}`;

async function mediaDir() {
  const root = await navigator.storage.getDirectory();
  return root.getDirectoryHandle(MEDIA_DIR, { create: true });
}

function nameOf(path: string) {
  const [dir, name] = path.split('/');
  if (dir !== MEDIA_DIR || !name) throw new Error(`Bad media path: ${path}`);
  return name;
}

/** Stream a file into OPFS without buffering it in memory. */
export async function writeMediaFile(path: string, file: Blob, onProgress?: (fraction: number) => void) {
  const handle = await (await mediaDir()).getFileHandle(nameOf(path), { create: true });
  const writable = await handle.createWritable();
  let written = 0;
  const counter = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      written += chunk.byteLength;
      onProgress?.(file.size ? written / file.size : 1);
      ctrl.enqueue(chunk);
    },
  });
  // pipeTo closes the writable on success and aborts it on error, so partial files are discarded.
  await file.stream().pipeThrough(counter).pipeTo(writable);
}

/** The stored file, or null when it is missing (e.g. site data was cleared). */
export async function getMediaFile(path: string): Promise<File | null> {
  try {
    return await (await (await mediaDir()).getFileHandle(nameOf(path))).getFile();
  } catch {
    return null;
  }
}

export async function listMediaFiles(): Promise<string[]> {
  const names: string[] = [];
  for await (const name of (await mediaDir()).keys()) names.push(`${MEDIA_DIR}/${name}`);
  return names;
}

export async function deleteMediaFile(path: string) {
  try {
    await (await mediaDir()).removeEntry(nameOf(path));
  } catch {
    // already gone
  }
}

/** Ask the browser not to evict our storage under pressure. Best effort. */
export async function requestPersistentStorage() {
  try {
    if (!(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // not supported
  }
}

export async function hasRoomFor(bytes: number) {
  try {
    const { quota = Infinity, usage = 0 } = await navigator.storage.estimate();
    return quota - usage > bytes * 1.05;
  } catch {
    return true;
  }
}
