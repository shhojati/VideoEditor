import { defineConfig } from '@playwright/test';

// Smoke tests against the production build (vite build + vite preview), exactly what gets deployed.
// Run with `npm run e2e:prod`.
const PORT = 4190;

export default defineConfig({
  testDir: 'e2e-prod',
  timeout: 120_000,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'chrome',
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 300_000,
  },
});
