// Account API. Env: PORT (3000), DB_PATH (/data/app.db), COOKIE_SECURE (1), TRUST_PROXY (1).
// `--dev` (npm run dev:api): server/data/dev.db, plain-http cookies, no proxy in front.
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.ts';
import { openDb } from './db.ts';

const dev = process.argv.includes('--dev');
const flag = (name: string, def: boolean) => (process.env[name] ?? (def ? '1' : '0')) !== '0';

const dbPath =
  process.env.DB_PATH ?? (dev ? join(fileURLToPath(new URL('../data', import.meta.url)), 'dev.db') : '/data/app.db');
mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);
const handle = createApp({
  db,
  secureCookies: flag('COOKIE_SECURE', !dev),
  trustProxy: flag('TRUST_PROXY', !dev),
});
const port = Number(process.env.PORT ?? 3000);
const server = createServer((req, res) => void handle(req, res));
server.on('error', (e: NodeJS.ErrnoException) => {
  console.error(e.code === 'EADDRINUSE' ? `api: port ${port} is already in use (another API running?)` : e);
  process.exit(1);
});
server.listen(port, () => console.log(`api listening on :${port} (${dbPath})`));

const stop = () => server.close(() => (db.close(), process.exit(0)));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
