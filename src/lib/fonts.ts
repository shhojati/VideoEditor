// Fonts for rendered text (text clips, subtitles), loaded from our own origin via the FontFace API
// so the same code works in the document and in workers (export). See scripts/copy-assets.mjs.
// Besides the built-in fonts, a project can use its own (Project.fonts): uploaded files, kept in
// browser storage like media, and fonts from the server's library/fonts folder.
import type { CustomFont } from '../model/types';
import { libraryUrl } from './library';
import { getMediaFile, mediaPathFor } from './opfs';

export interface FontChoice {
  family: string;
  /** Shown in the font picker. */
  label: string;
  weights: number[];
  /** Has Persian/Arabic glyphs. */
  persian: boolean;
}

export const FONT_CHOICES: FontChoice[] = [
  { family: 'Vazirmatn', label: 'وزیرمتن — Vazirmatn', weights: [300, 400, 500, 600, 700, 800, 900], persian: true },
  { family: 'Lalezar', label: 'لاله‌زار — Lalezar', weights: [400], persian: true },
  { family: 'Noto Naskh Arabic', label: 'نسخ — Noto Naskh', weights: [400, 700], persian: true },
  { family: 'Markazi Text', label: 'مرکزی — Markazi', weights: [400, 700], persian: true },
  { family: 'Inter', label: 'Inter', weights: [400, 500, 700], persian: false },
];

/** Glyphs missing from the chosen font (e.g. Persian in Inter) fall back to Vazirmatn. */
export const fontStack = (family: string) => `"${family}", "Vazirmatn", sans-serif`;

interface ManifestFace {
  family: string;
  weight: string;
  url: string;
  unicodeRange?: string;
}

type FontTarget = { add(face: FontFace): unknown };
const target = (): FontTarget =>
  ((globalThis as unknown as { document?: { fonts: FontTarget } }).document?.fonts ??
    (globalThis as unknown as { fonts: FontTarget }).fonts);

let manifest: Promise<ManifestFace[]> | null = null;
const loadManifest = () =>
  (manifest ??= fetch('/fonts/manifest.json')
    .then((r) => r.json() as Promise<{ faces: ManifestFace[] }>)
    .then((m) => m.faces)
    .catch((e) => {
      manifest = null;
      throw e;
    }));

const loads = new Map<string, Promise<void>>();
const ready = new Set<string>();

/** The current project's own fonts, by family (set by whoever renders it: the preview, the export worker). */
let custom = new Map<string, CustomFont>();
let customOf: readonly CustomFont[] | undefined;

export function setCustomFonts(fonts: readonly CustomFont[] | undefined) {
  if (fonts === customOf) return;
  customOf = fonts;
  custom = new Map((fonts ?? []).map((f) => [f.family, f]));
}

/** The pickers' list: the built-in fonts, then the project's own (one face: every weight). */
export function fontChoices(fonts: readonly CustomFont[] | undefined): FontChoice[] {
  return [...FONT_CHOICES, ...(fonts ?? []).map((f) => ({ family: f.family, label: f.family, weights: [400], persian: false }))];
}

/** Weight that will actually be used: the closest one the family ships (variable fonts: any). */
export function resolveWeight(family: string, weight: number): number {
  const choice = FONT_CHOICES.find((f) => f.family === family);
  if (!choice) return weight;
  return choice.weights.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a));
}

// A custom font is one face for every weight.
const keyOf = (family: string, weight: number) => (custom.has(family) ? `${family}@*` : `${family}@${resolveWeight(family, weight)}`);

export const isFontReady = (family: string, weight: number) => ready.has(keyOf(family, weight));

/** A project font's file: from the server, or the uploaded bytes in browser storage. */
async function customSource(f: CustomFont): Promise<string | ArrayBuffer> {
  if (f.library) return `url("${libraryUrl('fonts', f.library)}")`;
  const file = await getMediaFile(mediaPathFor(f.id));
  if (!file) throw new Error(`Font file missing: ${f.fileName}`);
  return file.arrayBuffer();
}

/** Register and load every subset of a family/weight (plus the Vazirmatn fallback). */
export function ensureFont(family: string, weight: number): Promise<void> {
  const w = resolveWeight(family, weight);
  const key = keyOf(family, weight);
  const own = custom.get(family);
  let p = loads.get(key);
  if (!p && own) {
    p = (async () => {
      const face = new FontFace(own.family, await customSource(own), { weight: '1 1000' });
      target().add(face);
      await face.load();
      await ensureFont('Vazirmatn', w);
      ready.add(key);
    })();
    p.catch(() => loads.delete(key));
    loads.set(key, p);
  }
  if (!p) {
    p = (async () => {
      const faces = (await loadManifest()).filter((f) => {
        if (f.family !== family) return false;
        const [lo, hi = lo] = f.weight.split(' ').map(Number);
        return w >= lo && w <= hi;
      });
      await Promise.all(
        faces.map(async (f) => {
          const face = new FontFace(f.family, `url("${f.url}")`, {
            weight: f.weight,
            ...(f.unicodeRange ? { unicodeRange: f.unicodeRange } : {}),
          });
          target().add(face);
          await face.load();
        }),
      );
      if (family !== 'Vazirmatn') await ensureFont('Vazirmatn', w);
      ready.add(key);
    })();
    p.catch(() => loads.delete(key));
    loads.set(key, p);
  }
  return p;
}
