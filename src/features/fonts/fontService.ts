// The project's own fonts: uploaded files (kept in browser storage like media, and saved in project
// bundles) and fonts from the server's library/fonts folder. Text clips and subtitle styles refer
// to them by family, like the built-in fonts (lib/fonts.ts).
import { displayName, LIBRARY_EXTENSIONS, type LibraryItem } from '../../lib/library';
import { FONT_CHOICES } from '../../lib/fonts';
import { mediaPathFor, writeMediaFile } from '../../lib/opfs';
import { newId } from '../../model/factories';
import type { CustomFont, Project } from '../../model/types';
import { rootProject, useProjectStore } from '../../store/projectStore';

export class FontFileError extends Error {}

/** A family name no built-in or project font has yet ("Name", "Name 2", …). */
export function uniqueFamily(name: string, fonts: readonly CustomFont[] | undefined): string {
  const taken = new Set([...FONT_CHOICES.map((f) => f.family), ...(fonts ?? []).map((f) => f.family)].map((f) => f.toLowerCase()));
  const base = name.trim() || 'Font';
  let family = base;
  for (let n = 2; taken.has(family.toLowerCase()); n++) family = `${base} ${n}`;
  return family;
}

function addFont(font: CustomFont) {
  useProjectStore.getState().edit('ops.addFont', (p: Project) => void (p.fonts ??= []).push(font));
}

/** Upload a .ttf/.otf/.woff/.woff2 into the project; returns its family. */
export async function uploadFont(file: File): Promise<string> {
  const ext = file.name.slice(file.name.lastIndexOf('.') + 1).toLowerCase();
  if (!LIBRARY_EXTENSIONS.fonts.includes(ext)) throw new FontFileError('type');
  // The browser has to be able to read it, or text would silently fall back.
  try {
    await new FontFace('font-check', await file.arrayBuffer()).load();
  } catch {
    throw new FontFileError('unreadable');
  }
  const id = newId();
  await writeMediaFile(mediaPathFor(id), file);
  const family = uniqueFamily(displayName(file.name), rootProject()?.fonts);
  addFont({ id, family, fileName: file.name });
  return family;
}

/** A server font for this project (added once); returns its family. */
export function addLibraryFont(item: LibraryItem): string {
  const fonts = rootProject()?.fonts;
  const known = fonts?.find((f) => f.library === item.path);
  if (known) return known.family;
  const family = uniqueFamily(item.name, fonts);
  addFont({ id: newId(), family, fileName: item.fileName, library: item.path });
  return family;
}
