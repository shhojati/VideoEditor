/// <reference types="vitest/config" />
import { rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Cross-origin isolation enables SharedArrayBuffer => multi-threaded ONNX Runtime WASM.
// The production static host must send these two headers as well (see docs/DEPLOY.md).
const isolation = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

/** public/spike-data holds test audio for spikes and E2E fixtures; it must not ship. */
function dropDevOnlyPublicFiles(): Plugin {
  let outDir = 'dist';
  return {
    name: 'drop-dev-only-public-files',
    apply: 'build',
    configResolved: (c) => void (outDir = c.build.outDir),
    closeBundle: () => rmSync(resolve(outDir, 'spike-data'), { recursive: true, force: true }),
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), dropDevOnlyPublicFiles()],
  server: { headers: isolation },
  preview: { headers: isolation },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['@huggingface/transformers'] },
  // The app is one ~900 kB (≈260 kB gzip) chunk; fine for an internal tool loaded once.
  build: { chunkSizeWarningLimit: 1200 },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
  },
});
