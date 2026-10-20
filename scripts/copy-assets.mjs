// Copies self-hosted runtime assets (fonts, ONNX Runtime WASM) from node_modules into public/.
// Runs automatically before dev/build so the app never touches a CDN at runtime.
import { cpSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const nm = join(root, 'node_modules');
const pub = join(root, 'public');

function copyMatching(srcDir, destDir, test) {
  mkdirSync(destDir, { recursive: true });
  for (const f of readdirSync(srcDir)) if (test(f)) cpSync(join(srcDir, f), join(destDir, f));
}

copyMatching(join(nm, 'vazirmatn/fonts/webfonts'), join(pub, 'fonts/vazirmatn'), (f) => f.endsWith('.woff2'));
copyMatching(join(nm, '@fontsource/inter/files'), join(pub, 'fonts/inter'), (f) =>
  /^inter-latin-(400|500|700)-normal\.woff2$/.test(f),
);
copyMatching(join(nm, 'onnxruntime-web/dist'), join(pub, 'wasm'), (f) => /^ort-wasm.*\.(wasm|mjs)$/.test(f));
console.log('assets copied to public/');
