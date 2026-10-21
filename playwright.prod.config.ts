import { defineConfig } from '@playwright/test';
import { STORAGE_STATE, apiServer } from './e2e/support/account';

// Smoke tests against the production build (vite build + vite preview), exactly what gets deployed.
// Run with `npm run e2e:prod`.
const PORT = 4190;
// Account API for this run (fresh database); the app's dev/preview server proxies /api to it.
const API_PORT = 3190;
process.env.E2E_API_PORT = String(API_PORT);

export default defineConfig({
  testDir: 'e2e-prod',
  timeout: 120_000,
  reporter: [['list']],
  globalSetup: './e2e/support/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: 'chrome',
    // Logged in as a Pro admin (e2e/support/account.ts).
    storageState: STORAGE_STATE,
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: [
    apiServer(API_PORT),
    {
      command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: false,
      timeout: 300_000,
      env: { API_PORT: String(API_PORT) },
    },
  ],
});
