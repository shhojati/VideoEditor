// Fonts for rendered text (text clips, subtitles), loaded from our own origin via the FontFace API
// so the same code works in the document and in workers (export). See scripts/copy-assets.mjs.

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

/** Weight that will actually be used: the closest one the family ships (variable fonts: any). */
export function resolveWeight(family: string, weight: number): number {
  const choice = FONT_CHOICES.find((f) => f.family === family);
  if (!choice) return weight;
  return choice.weights.reduce((a, b) => (Math.abs(b - weight) < Math.abs(a - weight) ? b : a));
}

const keyOf = (family: string, weight: number) => `${family}@${resolveWeight(family, weight)}`;

export const isFontReady = (family: string, weight: number) => ready.has(keyOf(family, weight));

/** Register and load every subset of a family/weight (plus the Vazirmatn fallback). */
export function ensureFont(family: string, weight: number): Promise<void> {
  const w = resolveWeight(family, weight);
  const key = `${family}@${w}`;
  let p = loads.get(key);
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
