import { expect, it } from 'vitest';
import en from './en.json';
import fa from './fa.json';

const keys = (o: object, prefix = ''): string[] =>
  Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? keys(v, `${prefix}${k}.`) : [`${prefix}${k}`]));

it('Persian and English translations have the same keys', () => {
  const faKeys = new Set(keys(fa));
  const enKeys = new Set(keys(en));
  expect([...enKeys].filter((k) => !faKeys.has(k))).toEqual([]);
  expect([...faKeys].filter((k) => !enKeys.has(k))).toEqual([]);
});
