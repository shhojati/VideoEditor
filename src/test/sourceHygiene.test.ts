import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

// Invisible bidi controls, zero-width characters and BOMs in source are unreadable in review and can
// visually reorder code ("Trojan Source"). Write them as backslash-u escapes instead.
// The class is built from code points so this file itself stays clean. ZWNJ (U+200C) is allowed:
// it is ordinary Persian orthography (e.g. in translations) and does not reorder text.
const ranges: [number, number][] = [
  [0x200b, 0x200b],
  [0x200d, 0x200f],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];
const isInvisible = (line: string) =>
  [...line].some((ch) => ranges.some(([lo, hi]) => ch.codePointAt(0)! >= lo && ch.codePointAt(0)! <= hi));

function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* files(p);
    else if (/\.(ts|tsx|mjs|json|css)$/.test(name)) yield p;
  }
}

it('source files contain no literal invisible characters', () => {
  const offenders: string[] = [];
  for (const dir of ['src', 'e2e', 'scripts']) {
    for (const f of files(dir)) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => isInvisible(line) && offenders.push(`${f}:${i + 1}`));
    }
  }
  expect(offenders).toEqual([]);
});

// A local npm mirror may write its own URLs into the lockfile; CI cannot reach it and `npm ci` fails.
// Fix with: sed -i 's#https://<mirror>/.../npm/#https://registry.npmjs.org/#' package-lock.json
it('the lockfile only points at the public npm registry', () => {
  const { packages } = JSON.parse(readFileSync('package-lock.json', 'utf8')) as {
    packages: Record<string, { resolved?: string }>;
  };
  const elsewhere = Object.entries(packages)
    .filter(([, p]) => p.resolved && !p.resolved.startsWith('https://registry.npmjs.org/'))
    .map(([name, p]) => `${name}: ${p.resolved}`);
  expect(elsewhere).toEqual([]);
});
