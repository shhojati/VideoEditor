// Owner-editable settings served from /config/ (public/config in the image, a mounted folder on the
// server: see public/config/README.md). Anything missing or invalid falls back to the defaults.
import { z } from 'zod';

export const WATERMARK_POSITIONS = ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'center'] as const;

const watermarkSchema = z.object({
  enabled: z.boolean().catch(true),
  text: z.string().max(200).catch('editor.shahabdev.ir'),
  /** File name under /config/ (or an absolute same-origin path); drawn instead of the text. */
  image: z.string().max(300).catch(''),
  position: z.enum(WATERMARK_POSITIONS).catch('bottom-right'),
  opacity: z.number().min(0).max(1).catch(0.7),
  /** Height as a fraction of the output's short side. */
  size: z.number().min(0.01).max(0.5).catch(0.045),
  /** Gap to the edges, same unit as size. */
  margin: z.number().min(0).max(0.3).catch(0.03),
  fontFamily: z.string().max(100).catch('Vazirmatn'),
  fontWeight: z.number().int().min(100).max(900).catch(700),
  color: z.string().max(50).catch('#ffffff'),
  shadow: z.boolean().catch(true),
});

export type WatermarkConfig = z.infer<typeof watermarkSchema>;

const pricingSchema = z.object({
  telegram: z.string().max(100).catch(''),
  freeMaxSeconds: z.number().positive().catch(60),
  passes: z
    .array(z.object({ months: z.number().int().positive(), priceToman: z.number().nonnegative() }))
    .catch([]),
  /** AI chat credit packs (server/src/chat.ts charges them per request). */
  creditPacks: z
    .array(z.object({ credits: z.number().int().positive(), priceToman: z.number().nonnegative() }))
    .catch([]),
});

export type PricingConfig = z.infer<typeof pricingSchema>;

/** Parses whatever the file holds; each bad or missing field gets its default. */
export const parseWatermark = (raw: unknown): WatermarkConfig =>
  watermarkSchema.parse(raw && typeof raw === 'object' ? raw : {});
export const parsePricing = (raw: unknown): PricingConfig =>
  pricingSchema.parse(raw && typeof raw === 'object' ? raw : {});

async function fetchJson(path: string): Promise<unknown> {
  try {
    const r = await fetch(path, { cache: 'no-cache' });
    return r.ok ? await r.json() : {};
  } catch {
    return {};
  }
}

let watermark: Promise<WatermarkConfig> | null = null;
let pricing: Promise<PricingConfig> | null = null;

/** Cached for the page's lifetime; the owner's edits apply on the next page load. */
export const loadWatermark = () => (watermark ??= fetchJson('/config/watermark.json').then(parseWatermark));
export const loadPricing = () => (pricing ??= fetchJson('/config/pricing.json').then(parsePricing));

/** URL of the watermark image, or null for a text watermark. */
export function watermarkImageUrl(wm: WatermarkConfig): string | null {
  const name = wm.image.trim();
  if (!name) return null;
  return name.startsWith('/') ? name : `/config/${name.replace(/^\.?\/+/, '')}`;
}
