import { defineConfig } from '@playwright/test';
import { STORAGE_STATE, apiServer } from './e2e/support/account';

const PORT = 5180;
// Account API for this run (fresh database); the app's dev/preview server proxies /api to it.
const API_PORT = 3180;
process.env.E2E_API_PORT = String(API_PORT);

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  fullyParallel: false,
  // Serial: the playback sync test measures real-time behaviour and flakes when other specs load the CPU.
  workers: 1,
  reporter: [['list']],
  globalSetup: './e2e/support/global-setup.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Use the installed Chrome: no browser download needed (restricted network).
    channel: 'chrome',
    // Logged in as a Pro admin (e2e/support/account.ts).
    storageState: STORAGE_STATE,
    viewport: { width: 1400, height: 900 },
    trace: 'retain-on-failure',
  },
  webServer: [
    apiServer(API_PORT),
    {
      command: `npm run dev -- --port ${PORT} --strictPort`,
      url: `http://localhost:${PORT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: { API_PORT: String(API_PORT) },
    },
  ],
});
