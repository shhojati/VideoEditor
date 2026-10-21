/// <reference types="vitest/config" />
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Cross-origin isolation enables SharedArrayBuffer => multi-threaded ONNX Runtime WASM.
// The production static host must send these two headers as well (see docs/DEPLOY.md).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/**
 * The server library (library/stickers, sounds, overlays) is listed by nginx as JSON
 * (autoindex_format json, see deploy/nginx.conf). In dev and preview the same listing is served from
 * public/library, so the panes work locally with files dropped there.
 */
function libraryListing(): Plugin {
  const root = resolve('public/library');
  const handler = (req: { url?: string }, res: import('node:http').ServerResponse, next: () => void) => {
    const path = decodeURIComponent((req.url ?? '').split('?')[0]);
    if (!path.startsWith('/library/') || !path.endsWith('/')) return next();
    const dir = resolve(root, '.' + path.slice('/library'.length));
    if (dir !== root && !dir.startsWith(root + sep)) return next();
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      res.statusCode = 404;
      return res.end();
    }
    const list = names.map((name) => {
      const st = statSync(join(dir, name));
      return st.isDirectory()
        ? { name, type: 'directory', mtime: st.mtime.toUTCString() }
        : { name, type: 'file', mtime: st.mtime.toUTCString(), size: st.size };
    });
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(list));
  };
  return {
    name: 'library-listing',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  };
}

/** public/spike-data holds test audio for spikes and E2E fixtures, public/library local library files; neither ships. */
function dropDevOnlyPublicFiles(): Plugin {
  let outDir = 'dist';
  return {
    name: 'drop-dev-only-public-files',
    apply: 'build',
    configResolved: (c) => void (outDir = c.build.outDir),
    closeBundle: () => {
      rmSync(resolve(outDir, 'spike-data'), { recursive: true, force: true });
      // The library is mounted on the server, never baked into the image.
      rmSync(resolve(outDir, 'library'), { recursive: true, force: true });
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), libraryListing(), dropDevOnlyPublicFiles()],
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es' },
  optimizeDeps: {
    exclude: ['@huggingface/transformers'],
    // Loaded lazily by the export worker; listed so the first export doesn't make Vite re-optimize
    // and reload the page.
    include: ['@mediabunny/aac-encoder', '@mediabunny/mp3-encoder'],
  },
  // The app is one ~900 kB (≈260 kB gzip) chunk; fine for an internal tool loaded once.
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
