// SQLite through Node's built-in node:sqlite: no native build, one file under /data on the server.
import { DatabaseSync } from 'node:sqlite';

export type Db = DatabaseSync;

/** Times are Unix milliseconds. `pro_until` in the past (or null) means the Free plan. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  pro_until INTEGER,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
-- Every Pro activation or revocation, for the owner's bookkeeping.
CREATE TABLE IF NOT EXISTS grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  months INTEGER NOT NULL,
  amount_toman INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  pro_until INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS grants_user ON grants(user_id);
-- AI apps that connect to /mcp (oauth.ts). Clients register themselves (dynamic registration).
CREATE TABLE IF NOT EXISTS oauth_clients (
  client_id TEXT PRIMARY KEY,
  secret_hash TEXT,
  name TEXT NOT NULL,
  redirect_uris TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri TEXT NOT NULL,
  challenge TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
-- Access and refresh tokens (only their SHA-256, like sessions).
CREATE TABLE IF NOT EXISTS oauth_tokens (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('access', 'refresh')),
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS oauth_tokens_user ON oauth_tokens(user_id);
-- AI chat credits (chat.ts): every purchase the owner records and every turn charged. users.credits is the sum.
CREATE TABLE IF NOT EXISTS credit_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('grant', 'chat', 'refund')),
  amount_toman INTEGER NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS credit_ledger_user ON credit_ledger(user_id);
`;

/** Columns added after the first release; CREATE TABLE IF NOT EXISTS leaves old databases without them. */
const COLUMNS: [table: string, column: string, definition: string][] = [['users', 'credits', 'INTEGER NOT NULL DEFAULT 0']];

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
  for (const [table, column, definition] of COLUMNS) {
    const have = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
    if (!have) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
  return db;
}

export interface UserRow {
  id: number;
  email: string;
  password_hash: string;
  is_admin: number;
  pro_until: number | null;
  created_at: number;
  last_login_at: number | null;
  credits: number;
}

/** Short id users quote on Telegram ("U-1042"). */
export const userCode = (id: number) => `U-${1000 + id}`;

/** "U-1042", "u1042" or "1042" → user id. */
export function idFromCode(code: string): number | null {
  const m = /^\s*u?-?\s*(\d+)\s*$/i.exec(code);
  if (!m) return null;
  const id = Number(m[1]) - 1000;
  return id > 0 ? id : null;
}

/** Calendar months after `from` (UTC), e.g. Jan 31 + 1 → Mar 3 like Date does; good enough for passes. */
export function addMonths(from: number, months: number): number {
  const d = new Date(from);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.getTime();
}
