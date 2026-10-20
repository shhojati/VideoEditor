// Copies self-hosted runtime assets (fonts, ONNX Runtime WASM) from node_modules into public/.
// Runs automatically before dev/build so the app never touches a CDN at runtime.
// Also writes public/fonts/manifest.json, used to register fonts with the FontFace API (which,
// unlike CSS @font-face, also works inside workers).
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const nm = join(root, 'node_modules');
const pub = join(root, 'public');

function copyMatching(srcDir, destDir, test) {
  mkdirSync(destDir, { recursive: true });
  for (const f of readdirSync(srcDir)) if (test(f)) cpSync(join(srcDir, f), join(destDir, f));
}

// Only the asyncify build is used (src/workers/stt.worker.ts sets wasmPaths to it).
rmSync(join(pub, 'wasm'), { recursive: true, force: true });
copyMatching(join(nm, 'onnxruntime-web/dist'), join(pub, 'wasm'), (f) => /^ort-wasm-simd-threaded\.asyncify\.(wasm|mjs)$/.test(f));

// ---- fonts ----
/** Fonts offered for text and subtitles. Subsets: Persian/Arabic + Latin. */
const FONTSOURCE = [
  { pkg: 'lalezar', weights: [400] },
  { pkg: 'noto-naskh-arabic', weights: [400, 700] },
  { pkg: 'markazi-text', weights: [400, 700] },
  { pkg: 'inter', weights: [400, 500, 700] },
];
const SUBSETS = new Set(['arabic', 'latin', 'latin-ext']);
const faces = [];
mkdirSync(join(pub, 'fonts'), { recursive: true });

// Vazirmatn: one variable file covering Persian and Latin.
copyMatching(join(nm, 'vazirmatn/fonts/webfonts'), join(pub, 'fonts/vazirmatn'), (f) => f === 'Vazirmatn[wght].woff2');
faces.push({ family: 'Vazirmatn', weight: '100 900', url: '/fonts/vazirmatn/Vazirmatn[wght].woff2' });

for (const { pkg, weights } of FONTSOURCE) {
  const dir = join(nm, '@fontsource', pkg);
  const dest = join(pub, 'fonts', pkg);
  mkdirSync(dest, { recursive: true });
  for (const w of weights) {
    const css = readFileSync(join(dir, `${w}.css`), 'utf8');
    for (const block of css.matchAll(/\/\* ([\w-]+) \*\/\s*@font-face\s*{([^}]*)}/g)) {
      const [, name, body] = block;
      const subset = name.slice(pkg.length + 1).replace(new RegExp(`-${w}-normal$`), '');
      if (!SUBSETS.has(subset)) continue;
      const file = body.match(/url\(\.\/files\/([^)]+\.woff2)\)/)?.[1];
      const family = body.match(/font-family:\s*'([^']+)'/)?.[1];
      const range = body.match(/unicode-range:\s*([^;]+);/)?.[1];
      if (!file || !family) continue;
      cpSync(join(dir, 'files', file), join(dest, file));
      faces.push({ family, weight: String(w), url: `/fonts/${pkg}/${file}`, unicodeRange: range });
    }
  }
}
writeFileSync(join(pub, 'fonts/manifest.json'), JSON.stringify({ faces }, null, 1));

// UI fonts referenced from index.css.
copyMatching(join(nm, '@fontsource/inter/files'), join(pub, 'fonts/inter'), (f) =>
  /^inter-latin-(400|500|700)-normal\.woff2$/.test(f),
);
console.log(`assets copied to public/ (${faces.length} font faces)`);
