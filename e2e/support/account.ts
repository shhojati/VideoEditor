// Shared by both Playwright configs: the API server, and a logged-in Pro admin for every test
// (export needs an account; Pro keeps exports free of the watermark). account.spec.ts covers the
// logged-out and Free paths with its own empty storage state.
import { request, type FullConfig } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';

const DATA = resolve('server/data');
export const STORAGE_STATE = resolve(DATA, 'e2e-auth.json');
export const E2E_EMAIL = 'e2e-owner@example.com';
export const E2E_PASSWORD = 'e2e-password';

export const apiDbPath = (port: number) => resolve(DATA, `e2e-${port}.db`);

export function apiServer(port: number) {
  return {
    command: 'node e2e/support/api-server.mjs',
    url: `http://127.0.0.1:${port}/api/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PORT: String(port), DB_PATH: apiDbPath(port), COOKIE_SECURE: '0', TRUST_PROXY: '0', NODE_NO_WARNINGS: '1' },
  };
}

/** globalSetup: register the owner account through the app's proxy, make it Pro + admin, save the cookie. */
export async function setupAccount(config: FullConfig, apiPort: number) {
  const baseURL = config.projects[0].use.baseURL!;
  mkdirSync(dirname(STORAGE_STATE), { recursive: true });
  const ctx = await request.newContext({ baseURL });
  const r = await ctx.post('/api/auth/register', { data: { email: E2E_EMAIL, password: E2E_PASSWORD } });
  if (!r.ok()) throw new Error(`E2E account: ${r.status()} ${await r.text()}`);
  const db = new DatabaseSync(apiDbPath(apiPort));
  db.prepare('UPDATE users SET is_admin = 1, pro_until = ? WHERE email = ?').run(Date.now() + 365 * 86_400_000, E2E_EMAIL);
  db.close();
  await ctx.storageState({ path: STORAGE_STATE });
  await ctx.dispose();
}
