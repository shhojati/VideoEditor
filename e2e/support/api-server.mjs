// Account API for E2E runs: a fresh database every run (DB_PATH from the Playwright config).
import { rmSync } from 'node:fs';

for (const suffix of ['', '-wal', '-shm']) rmSync(process.env.DB_PATH + suffix, { force: true });
await import('../../server/src/index.ts');
