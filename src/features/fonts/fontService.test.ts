import { describe, expect, it } from 'vitest';
import { FONT_CHOICES, fontChoices } from '../../lib/fonts';
import { uniqueFamily } from './fontService';

describe('project fonts', () => {
  const fonts = [{ id: 'a', family: 'My Font', fileName: 'My_Font.ttf' }];

  it('lists the built-in fonts, then the project’s own with one face for every weight', () => {
    const list = fontChoices(fonts);
    expect(list.slice(0, FONT_CHOICES.length)).toEqual(FONT_CHOICES);
    expect(list.at(-1)).toMatchObject({ family: 'My Font', weights: [400] });
    expect(fontChoices(undefined)).toEqual(FONT_CHOICES);
  });

  it('gives a new font a family name nothing else uses', () => {
    expect(uniqueFamily('Brand', fonts)).toBe('Brand');
    expect(uniqueFamily('my font', fonts)).toBe('my font 2');
    expect(uniqueFamily('Vazirmatn', fonts)).toBe('Vazirmatn 2');
    expect(uniqueFamily('  ', fonts)).toBe('Font');
  });
});
