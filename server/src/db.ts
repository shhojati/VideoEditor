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
`;

export function openDb(path: string): Db {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL;');
  db.exec(SCHEMA);
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
