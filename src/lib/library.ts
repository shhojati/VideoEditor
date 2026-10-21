// The server's media library: files the owner drops into library/<kind>/ on the server (one level
// of subfolders = categories). The folder is listed by the web server as JSON (nginx
// `autoindex_format json`; the dev server mimics it), so there is no manifest to maintain.
import type { LibraryKind } from '../model/types';

export const LIBRARY_ROOT = '/library';

export const LIBRARY_EXTENSIONS: Record<LibraryKind, string[]> = {
  stickers: ['png', 'gif'],
  sounds: ['ogg', 'mp3'],
  overlays: ['mp4', 'webm', 'mov'],
  templates: ['json'],
};

export const LIBRARY_MIME: Record<string, string> = {
  png: 'image/png',
  gif: 'image/gif',
  ogg: 'audio/ogg',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  json: 'application/json',
};

export interface LibraryItem {
  kind: LibraryKind;
  /** Display name: the file name without extension, with _ and - as spaces. */
  name: string;
  fileName: string;
  /** Path below the kind's folder, e.g. "emoji/smile.gif". */
  path: string;
  /** Encoded URL to fetch it from. */
  url: string;
  /** Subfolder name; '' for files directly in the kind's folder. */
  category: string;
  size?: number;
}

/** One entry of an nginx JSON directory listing. */
interface ListingEntry {
  name: string;
  type: 'file' | 'directory' | 'other';
  size?: number;
}

const extOf = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();
export const displayName = (fileName: string) => fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim();
export const libraryUrl = (kind: LibraryKind, path: string) =>
  `${LIBRARY_ROOT}/${kind}/${path.split('/').map(encodeURIComponent).join('/')}`;

export class LibraryUnavailable extends Error {}

async function listDir(url: string): Promise<ListingEntry[]> {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (res.status === 404) throw new LibraryUnavailable(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const data: unknown = await res.json().catch(() => {
    throw new LibraryUnavailable(url); // an HTML page: the folder is not set up for listing
  });
  if (!Array.isArray(data)) throw new LibraryUnavailable(url);
  return data as ListingEntry[];
}

/**
 * Every usable file of one kind, sorted by category then name. Hidden files and other types are
 * skipped. Throws LibraryUnavailable when the server has no such folder.
 */
export async function listLibrary(kind: LibraryKind): Promise<LibraryItem[]> {
  const exts = LIBRARY_EXTENSIONS[kind];
  const items: LibraryItem[] = [];
  const add = (entries: ListingEntry[], category: string) => {
    for (const e of entries) {
      if (e.type !== 'file' || e.name.startsWith('.') || !exts.includes(extOf(e.name))) continue;
      const path = category ? `${category}/${e.name}` : e.name;
      items.push({ kind, name: displayName(e.name), fileName: e.name, path, url: libraryUrl(kind, path), category, size: e.size });
    }
  };
  const top = await listDir(`${LIBRARY_ROOT}/${kind}/`);
  add(top, '');
  const dirs = top.filter((e) => e.type === 'directory' && !e.name.startsWith('.'));
  const subs = await Promise.all(dirs.map((d) => listDir(`${libraryUrl(kind, d.name)}/`).catch(() => [])));
  dirs.forEach((d, i) => add(subs[i], d.name));
  const coll = new Intl.Collator(undefined, { numeric: true });
  return items.sort((a, b) => coll.compare(a.category, b.category) || coll.compare(a.name, b.name));
}

/** Download a library file as a File (named and typed for the importer). */
export async function fetchLibraryFile(item: LibraryItem): Promise<File> {
  const res = await fetch(item.url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const blob = await res.blob();
  return new File([blob], item.fileName, { type: LIBRARY_MIME[extOf(item.fileName)] ?? blob.type });
}
