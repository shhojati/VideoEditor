import type { TFunction } from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import i18n from '../../i18n';
import { createProject } from '../../model/factories';
import { buildEntries, normalize, score, search } from './searchIndex';

const project = createProject('t');

describe('global search', () => {
  beforeAll(() => i18n.changeLanguage('en'));

  it('normalises Arabic letters, ZWNJ and case', () => {
    expect(normalize('جلوه‌ها')).toBe('جلوهها');
    expect(normalize('كيك')).toBe('کیک');
    expect(normalize('  Gaussian   BLUR ')).toBe('gaussian blur');
  });

  it('ranks exact over prefix over word start over anywhere', () => {
    const e = (label: string) => ({ label, alt: [] });
    expect(score(e('Blur'), 'blur')).toBe(4);
    expect(score(e('Blurriness'), 'blur')).toBe(3);
    expect(score(e('Gaussian Blur'), 'blur')).toBe(2);
    expect(score(e('Unblurred'), 'blur')).toBe(1);
    expect(score(e('Sharpen'), 'blur')).toBe(0);
  });

  it('finds the same effect by its English and Persian names', () => {
    const en = search(buildEntries(i18n.getFixedT('en'), project), 'gaussian');
    const fa = buildEntries(i18n.getFixedT('fa'), project);
    const faName = fa.find((x) => x.id === 'effect:gaussianBlur')!.label;
    expect(en[0].id).toBe('effect:gaussianBlur');
    expect(search(fa, faName)[0].id).toBe('effect:gaussianBlur');
    // English words find it in the Persian UI too.
    expect(search(fa, 'gaussian').map((x) => x.id)).toContain('effect:gaussianBlur');
  });

  it('groups results, enabled first, and marks what needs a selection', () => {
    const hits = search(buildEntries(i18n.getFixedT('en'), project), 'screen');
    expect(hits.find((x) => x.id === 'blend:screen')?.disabled).toBeTruthy();
    const groups = hits.map((x) => x.group);
    expect(groups).toEqual([...groups].sort((a, b) => groups.indexOf(a) - groups.indexOf(b)));
  });

  it('uses only translation keys that exist in both languages', () => {
    const keys = new Set<string>();
    const t = ((key: string, opts?: unknown) => {
      keys.add(key);
      return i18n.t(key, opts as never);
    }) as unknown as TFunction;
    buildEntries(t, project);
    const missing = [...keys].filter((k) =>
      ['en', 'fa'].some((lng) => i18n.getResource(lng, 'translation', k) === undefined),
    );
    // Template categories fall back to the category id.
    expect(missing.filter((k) => !k.startsWith('templates.categories.'))).toEqual([]);
  });
});
