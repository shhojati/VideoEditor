// Templates: ready-made titles, intros, outros, lower thirds… as a set of overlay clips (text,
// shapes, effects) with relative times. Built-in ones are here; more come from the server's
// /library/templates/ folder as JSON in the same format (checked with templateSchema).
import { z } from 'zod';
import { createEffect, EFFECT_KINDS } from './effects';
import { newId } from './factories';
import { createOverlayClip, insertClip } from './timeline';
import type { Clip, EffectKind, ID, Project, ShapeProps, TextAnimKind, TextProps, Transform } from './types';
import { TEXT_ANIMS } from './textAnim';

export type TemplateCategory = 'title' | 'intro' | 'outro' | 'lowerThird' | 'social';
export const TEMPLATE_CATEGORIES: TemplateCategory[] = ['title', 'intro', 'lowerThird', 'social', 'outro'];

export interface TemplateClip {
  /** Layer from the bottom (0 = the lowest of the template's new graphics tracks). */
  layer: number;
  /** Seconds from where the template is inserted. */
  start: number;
  duration: number;
  /** `contentFa`: the placeholder text used when the template is inserted in Persian. */
  text?: Partial<TextProps> & { content: string; contentFa?: string };
  shape?: Partial<ShapeProps> & { kind: ShapeProps['kind'] };
  transform?: Partial<Transform>;
  effects?: { kind: EffectKind; params?: Record<string, number | string | boolean> }[];
}

export interface Template {
  id: string;
  /** Display names; the first one is used when the UI language is missing. */
  name: { en: string; fa?: string };
  category: TemplateCategory;
  duration: number;
  clips: TemplateClip[];
}

const anim = z.enum(TEXT_ANIMS as [TextAnimKind, ...TextAnimKind[]]);
export const templateSchema = z.object({
  id: z.string(),
  name: z.object({ en: z.string(), fa: z.string().optional() }),
  category: z.enum(['title', 'intro', 'outro', 'lowerThird', 'social']),
  duration: z.number().positive().max(120),
  clips: z
    .array(
      z.object({
        layer: z.number().int().min(0).max(9),
        start: z.number().min(0),
        duration: z.number().positive(),
        text: z
          .object({ content: z.string(), contentFa: z.string().optional(), anim: z.object({ in: anim.optional(), out: anim.optional(), duration: z.number().positive().optional() }).optional() })
          .passthrough()
          .optional(),
        shape: z.object({ kind: z.enum(['rectangle', 'square', 'circle', 'oval', 'triangle', 'star', 'line']) }).passthrough().optional(),
        transform: z.object({}).passthrough().optional(),
        effects: z.array(z.object({ kind: z.enum(EFFECT_KINDS), params: z.record(z.string(), z.union([z.number(), z.string(), z.boolean()])).optional() })).optional(),
      }),
    )
    .min(1)
    .max(40),
});

const TEXT_DEFAULTS: TextProps = {
  content: '',
  fontFamily: 'Vazirmatn',
  fontSize: 72,
  fontWeight: 700,
  color: '#ffffff',
  align: 'center',
  rtl: false,
  fadeIn: 0,
  fadeOut: 0,
};
const SHAPE_DEFAULTS: ShapeProps = { kind: 'rectangle', width: 400, height: 120, fill: '#ffffff', strokeWidth: 0, fadeIn: 0, fadeOut: 0 };

/** The clip a template clip becomes, at `at` seconds on the timeline. */
export function templateClip(c: TemplateClip, at: number, rtl: boolean): Clip {
  const { contentFa, ...text } = c.text ?? { content: '' };
  const clip = createOverlayClip(at + c.start, {
    ...(c.text && { text: { ...TEXT_DEFAULTS, ...text, rtl, content: rtl && contentFa ? contentFa : text.content } as TextProps }),
    ...(c.shape && { shape: { ...SHAPE_DEFAULTS, ...c.shape } as ShapeProps }),
    ...(c.effects && { effects: c.effects.map((e) => createEffect(e.kind, e.params)) }),
  });
  clip.duration = c.duration;
  clip.transform = { ...clip.transform, x: 0, y: 0, ...c.transform };
  return clip;
}

/**
 * Insert a template at time `at` on new graphics tracks on top of everything (one per layer), so
 * it never collides with existing clips. Returns the new clip ids.
 */
export function insertTemplate(p: Project, tpl: Template, at: number, rtl: boolean): ID[] {
  const layers = Math.max(...tpl.clips.map((c) => c.layer)) + 1;
  const tracks = Array.from({ length: layers }, () => ({ id: newId(), kind: 'text' as const, muted: false, locked: false, clips: [] as Clip[] }));
  p.tracks.push(...tracks);
  return tpl.clips.map((c) => {
    const clip = templateClip(c, Math.max(0, at), rtl);
    insertClip(tracks[c.layer], clip);
    return clip.id;
  });
}

// ---- built-in templates ----------------------------------------------------------------------------

const ACCENT = '#7c3aed';
const t = (content: string, contentFa: string, more: Partial<TextProps> = {}): TemplateClip['text'] => ({ content, contentFa, ...more });

export const BUILTIN_TEMPLATES: Template[] = [
  {
    id: 'title-pop',
    name: { en: 'Big title', fa: 'تیتر بزرگ' },
    category: 'title',
    duration: 4,
    clips: [
      { layer: 0, start: 0, duration: 4, text: t('Your title', 'تیتر شما', { fontSize: 140, fontWeight: 900, strokeColor: '#000000', strokeWidth: 8, anim: { in: 'pop', out: 'fade', duration: 0.5 } }), transform: { y: -0.05 } },
      { layer: 1, start: 0.4, duration: 3.6, text: t('A short subtitle', 'یک توضیح کوتاه', { fontSize: 56, fontWeight: 500, color: '#e5e7eb', anim: { in: 'slideUp', out: 'fade' } }), transform: { y: 0.1 } },
    ],
  },
  {
    id: 'title-typewriter',
    name: { en: 'Typewriter title', fa: 'تیتر ماشین‌تحریری' },
    category: 'title',
    duration: 4,
    clips: [{ layer: 0, start: 0, duration: 4, text: t('Once upon a time…', 'روزی روزگاری…', { fontFamily: 'Vazirmatn', fontSize: 88, fontWeight: 600, anim: { in: 'typewriter', out: 'fade', duration: 1.5 } }) }],
  },
  {
    id: 'chapter',
    name: { en: 'Chapter', fa: 'فصل' },
    category: 'title',
    duration: 3,
    clips: [
      { layer: 0, start: 0, duration: 3, shape: { kind: 'line', width: 600, height: 0, stroke: '#ffffff', strokeWidth: 4 }, transform: { y: 0.06 }, effects: [{ kind: 'linearWipe', params: { completion: 100, angle: 90, animate: 'in', animDuration: 0.6 } }] },
      { layer: 1, start: 0.2, duration: 2.8, text: t('Chapter 1', 'فصل ۱', { fontSize: 96, fontWeight: 800, anim: { in: 'wipe', out: 'fade' } }), transform: { y: -0.02 } },
    ],
  },
  {
    id: 'intro-welcome',
    name: { en: 'Welcome intro', fa: 'آغاز: خوش آمدید' },
    category: 'intro',
    duration: 4,
    clips: [
      { layer: 0, start: 0, duration: 4, shape: { kind: 'rectangle', width: 3000, height: 3000, fill: ACCENT }, effects: [{ kind: 'linearWipe', params: { completion: 100, angle: 90, animate: 'out', animDuration: 0.6 } }] },
      { layer: 1, start: 0.3, duration: 3.2, text: t('Welcome', 'خوش آمدید', { fontSize: 150, fontWeight: 900, anim: { in: 'zoom', out: 'fade' } }) },
    ],
  },
  {
    id: 'intro-minimal',
    name: { en: 'Minimal intro', fa: 'آغاز ساده' },
    category: 'intro',
    duration: 3.5,
    clips: [
      { layer: 0, start: 0, duration: 3.5, text: t('PRESENTS', 'تقدیم می‌کند', { fontSize: 40, fontWeight: 400, color: '#d1d5db', anim: { in: 'fade', out: 'fade', duration: 1 } }), transform: { y: 0.08 } },
      { layer: 1, start: 0.5, duration: 3, text: t('Studio Name', 'نام استودیو', { fontSize: 110, fontWeight: 300, anim: { in: 'blurIn', out: 'fade', duration: 1 } }), transform: { y: -0.02 } },
    ],
  },
  {
    id: 'countdown',
    name: { en: 'Countdown 3-2-1', fa: 'شمارش معکوس' },
    category: 'intro',
    duration: 3,
    clips: [3, 2, 1].map((n, i) => ({ layer: 0, start: i, duration: 1, text: t(String(n), '۰۱۲۳۴۵۶۷۸۹'[n], { fontSize: 320, fontWeight: 900, strokeColor: '#000000', strokeWidth: 10, anim: { in: 'pop', out: 'fade', duration: 0.3 } }) })),
  },
  {
    id: 'lower-classic',
    name: { en: 'Lower third', fa: 'زیرنویس نام' },
    category: 'lowerThird',
    duration: 5,
    clips: [
      { layer: 0, start: 0, duration: 5, shape: { kind: 'rectangle', width: 760, height: 150, fill: '#111827', fillOpacity: 0.85, cornerRadius: 8 }, transform: { x: -0.18, y: 0.33 }, effects: [{ kind: 'linearWipe', params: { completion: 100, angle: 90, animate: 'in', animDuration: 0.5 } }] },
      { layer: 1, start: 0, duration: 5, shape: { kind: 'rectangle', width: 12, height: 150, fill: ACCENT }, transform: { x: -0.37, y: 0.33 } },
      { layer: 2, start: 0.3, duration: 4.7, text: t('Full Name', 'نام و نام خانوادگی', { fontSize: 54, fontWeight: 800, align: 'left', anim: { in: 'slideRight', out: 'fade' } }), transform: { x: -0.2, y: 0.31 } },
      { layer: 3, start: 0.5, duration: 4.5, text: t('Role or title', 'سمت یا عنوان', { fontSize: 34, fontWeight: 400, color: '#c4b5fd', align: 'left', anim: { in: 'slideRight', out: 'fade' } }), transform: { x: -0.22, y: 0.36 } },
    ],
  },
  {
    id: 'lower-pill',
    name: { en: 'Lower third, pill', fa: 'زیرنویس نام گرد' },
    category: 'lowerThird',
    duration: 5,
    clips: [
      { layer: 0, start: 0, duration: 5, shape: { kind: 'rectangle', width: 620, height: 110, fill: '#ffffff', cornerRadius: 55 }, transform: { y: 0.36 }, effects: [{ kind: 'dropShadow', params: {} }] },
      { layer: 1, start: 0.2, duration: 4.8, text: t('Name · Role', 'نام · سمت', { fontSize: 50, fontWeight: 700, color: '#111827', anim: { in: 'pop', out: 'fade' } }), transform: { y: 0.36 } },
    ],
  },
  {
    id: 'breaking',
    name: { en: 'Breaking news bar', fa: 'نوار خبر فوری' },
    category: 'lowerThird',
    duration: 6,
    clips: [
      { layer: 0, start: 0, duration: 6, shape: { kind: 'rectangle', width: 3000, height: 120, fill: '#dc2626' }, transform: { y: 0.38 } },
      { layer: 1, start: 0, duration: 6, shape: { kind: 'rectangle', width: 300, height: 120, fill: '#111827' }, transform: { x: -0.38, y: 0.38 } },
      { layer: 2, start: 0, duration: 6, text: t('BREAKING', 'فوری', { fontSize: 44, fontWeight: 900 }), transform: { x: -0.38, y: 0.38 } },
      { layer: 3, start: 0.3, duration: 5.7, text: t('Headline goes here', 'تیتر خبر اینجا', { fontSize: 48, fontWeight: 700, align: 'left', anim: { in: 'slideLeft', out: 'fade' } }), transform: { x: -0.05, y: 0.38 } },
    ],
  },
  {
    id: 'location',
    name: { en: 'Location tag', fa: 'برچسب مکان' },
    category: 'lowerThird',
    duration: 4,
    clips: [
      { layer: 0, start: 0, duration: 4, shape: { kind: 'circle', width: 46, height: 46, fill: '#ef4444' }, transform: { x: -0.3, y: -0.35 } },
      { layer: 1, start: 0.2, duration: 3.8, text: t('Tehran, Iran', 'تهران، ایران', { fontSize: 46, fontWeight: 600, align: 'left', shadowColor: '#000000', shadowBlur: 12, anim: { in: 'slideRight', out: 'fade' } }), transform: { x: -0.17, y: -0.35 } },
    ],
  },
  {
    id: 'subscribe',
    name: { en: 'Subscribe button', fa: 'دکمه‌ی دنبال کردن' },
    category: 'social',
    duration: 4,
    clips: [
      { layer: 0, start: 0, duration: 4, shape: { kind: 'rectangle', width: 420, height: 110, fill: '#dc2626', cornerRadius: 16 }, transform: { y: 0.3 }, effects: [{ kind: 'dropShadow', params: {} }] },
      { layer: 1, start: 0, duration: 4, text: t('SUBSCRIBE', 'دنبال کنید', { fontSize: 52, fontWeight: 900, anim: { in: 'pop', out: 'fade' } }), transform: { y: 0.3 } },
    ],
  },
  {
    id: 'follow',
    name: { en: 'Follow @username', fa: 'دنبال کنید' },
    category: 'social',
    duration: 4,
    clips: [
      { layer: 0, start: 0, duration: 4, text: t('Follow for more', 'برای دیدن بیشتر دنبال کنید', { fontSize: 46, fontWeight: 500, anim: { in: 'fade', out: 'fade' } }), transform: { y: 0.28 } },
      { layer: 1, start: 0.3, duration: 3.7, text: t('@username', '@username', { fontSize: 72, fontWeight: 900, color: '#fde047', strokeColor: '#000000', strokeWidth: 6, anim: { in: 'pop', out: 'fade' } }), transform: { y: 0.35 } },
    ],
  },
  {
    id: 'quote',
    name: { en: 'Quote', fa: 'نقل قول' },
    category: 'social',
    duration: 6,
    clips: [
      { layer: 0, start: 0, duration: 6, text: t('“', '«', { fontSize: 260, fontWeight: 900, color: ACCENT, anim: { in: 'fade', out: 'fade' } }), transform: { y: -0.22 } },
      { layer: 1, start: 0.3, duration: 5.7, text: t('The best way out is always through.', 'بهترین راه خروج، همیشه گذشتن از میان آن است.', { fontSize: 64, fontWeight: 500, anim: { in: 'wordByWord', out: 'fade', duration: 1.5 } }) },
      { layer: 2, start: 2, duration: 4, text: t('— Robert Frost', '— رابرت فراست', { fontSize: 40, fontWeight: 400, color: '#d1d5db', anim: { in: 'fade', out: 'fade' } }), transform: { y: 0.15 } },
    ],
  },
  {
    id: 'outro-thanks',
    name: { en: 'Thanks for watching', fa: 'ممنون که تماشا کردید' },
    category: 'outro',
    duration: 5,
    clips: [
      { layer: 0, start: 0, duration: 5, text: t('Thanks for watching!', 'ممنون که تماشا کردید!', { fontSize: 110, fontWeight: 900, anim: { in: 'zoom', out: 'fade' } }), transform: { y: -0.05 } },
      { layer: 1, start: 0.8, duration: 4.2, text: t('See you in the next one', 'تا ویدیوی بعدی', { fontSize: 50, fontWeight: 400, color: '#e5e7eb', anim: { in: 'slideUp', out: 'fade' } }), transform: { y: 0.08 } },
    ],
  },
  {
    id: 'end-card',
    name: { en: 'End card', fa: 'کارت پایانی' },
    category: 'outro',
    duration: 8,
    clips: [
      { layer: 0, start: 0, duration: 8, shape: { kind: 'rectangle', width: 560, height: 315, fill: '#000000', fillOpacity: 0.5, stroke: '#ffffff', strokeWidth: 4, cornerRadius: 12 }, transform: { x: -0.2, y: 0.08 } },
      { layer: 1, start: 0, duration: 8, shape: { kind: 'rectangle', width: 560, height: 315, fill: '#000000', fillOpacity: 0.5, stroke: '#ffffff', strokeWidth: 4, cornerRadius: 12 }, transform: { x: 0.2, y: 0.08 } },
      { layer: 2, start: 0, duration: 8, text: t('Watch next', 'ویدیوی بعدی', { fontSize: 64, fontWeight: 800, anim: { in: 'slideDown', out: 'fade' } }), transform: { y: -0.3 } },
    ],
  },
];

/** The name to show for a template in `lang`. */
export const templateName = (tpl: Template, lang: string) => (lang === 'fa' ? tpl.name.fa : undefined) ?? tpl.name.en;
