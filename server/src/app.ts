// The account API behind /api (nginx proxies it, so it is same-origin with the editor). Plain
// node:http: a dozen JSON routes do not need a framework.
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  MAX_PASSWORD,
  MIN_PASSWORD,
  hashPassword,
  isEmail,
  newToken,
  normalizeEmail,
  tempPassword,
  tokenHash,
  verifyPassword,
} from './auth.ts';
import { addMonths, idFromCode, userCode, type Db, type UserRow } from './db.ts';
import { RateLimiter } from './rateLimit.ts';

export const COOKIE = 've_session';
const DAY = 86_400_000;
export const SESSION_MS = 30 * DAY;
const MAX_BODY = 16 * 1024;

export interface AppOptions {
  db: Db;
  now?: () => number;
  /** Send the cookie with `Secure` (production). Off for plain-http local dev. */
  secureCookies?: boolean;
  /** Read the client IP from X-Forwarded-For (behind Caddy → nginx). */
  trustProxy?: boolean;
}

/** Error codes the editor translates (src/i18n: account.errors.*). */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  path: string;
  query: URLSearchParams;
  ip: string;
  body: () => Promise<Record<string, unknown>>;
}

export type Plan = 'free' | 'pro';

export interface Me {
  id: number;
  code: string;
  email: string;
  isAdmin: boolean;
  plan: Plan;
  proUntil: number | null;
}

export function createApp(opts: AppOptions) {
  const { db } = opts;
  const now = opts.now ?? Date.now;
  const loginLimit = new RateLimiter(20, 15 * 60_000, now);
  const registerLimit = new RateLimiter(5, 60 * 60_000, now);

  const toMe = (u: UserRow): Me => ({
    id: u.id,
    code: userCode(u.id),
    email: u.email,
    isAdmin: !!u.is_admin,
    plan: u.pro_until != null && u.pro_until > now() ? 'pro' : 'free',
    proUntil: u.pro_until,
  });

  const userById = (id: number) => db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;

  function setCookie(res: ServerResponse, token: string, maxAgeMs: number) {
    const parts = [`${COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
    if (opts.secureCookies) parts.push('Secure');
    res.setHeader('Set-Cookie', parts.join('; '));
  }

  function startSession(res: ServerResponse, userId: number) {
    const token = newToken();
    db.prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(
      tokenHash(token),
      userId,
      now() + SESSION_MS,
    );
    db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(now(), userId);
    setCookie(res, token, SESSION_MS);
  }

  function sessionToken(req: IncomingMessage): string | null {
    for (const part of (req.headers.cookie ?? '').split(';')) {
      const [k, ...v] = part.trim().split('=');
      if (k === COOKIE) return v.join('=') || null;
    }
    return null;
  }

  /** The logged-in user, or null. Sliding expiry: renewed when more than a day old. */
  function currentUser(ctx: Ctx): UserRow | null {
    const token = sessionToken(ctx.req);
    if (!token) return null;
    const hash = tokenHash(token);
    const s = db.prepare('SELECT user_id, expires_at FROM sessions WHERE token_hash = ?').get(hash) as
      | { user_id: number; expires_at: number }
      | undefined;
    if (!s) return null;
    if (s.expires_at <= now()) {
      db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
      return null;
    }
    if (s.expires_at - now() < SESSION_MS - DAY) {
      db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(now() + SESSION_MS, hash);
      setCookie(ctx.res, token, SESSION_MS);
    }
    return userById(s.user_id) ?? null;
  }

  const requireUser = (ctx: Ctx) => {
    const u = currentUser(ctx);
    if (!u) throw new ApiError(401, 'unauthorized');
    return u;
  };
  const requireAdmin = (ctx: Ctx) => {
    const u = requireUser(ctx);
    if (!u.is_admin) throw new ApiError(403, 'forbidden');
    return u;
  };

  const str = (v: unknown, max = 1000) => (typeof v === 'string' && v.length <= max ? v : null);
  const int = (v: unknown, min: number, max: number) =>
    typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;

  function checkPassword(p: unknown): string {
    const s = str(p, MAX_PASSWORD);
    if (s == null || s.length < MIN_PASSWORD) throw new ApiError(400, 'weak_password');
    return s;
  }

  function targetUser(id: string) {
    const u = userById(Number(id));
    if (!u) throw new ApiError(404, 'not_found');
    return u;
  }

  /** Admin view of a user. */
  const adminUser = (u: UserRow) => ({ ...toMe(u), createdAt: u.created_at, lastLoginAt: u.last_login_at });

  type Handler = (ctx: Ctx, params: string[]) => Promise<unknown> | unknown;
  const routes: [string, RegExp, Handler][] = [
    ['GET', /^\/api\/health$/, () => ({ ok: true })],

    [
      'POST',
      /^\/api\/auth\/register$/,
      async (ctx) => {
        if (!registerLimit.hit(ctx.ip)) throw new ApiError(429, 'rate_limited');
        const b = await ctx.body();
        const email = normalizeEmail(str(b.email, 300) ?? '');
        if (!isEmail(email)) throw new ApiError(400, 'invalid_email');
        const password = checkPassword(b.password);
        if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new ApiError(409, 'email_taken');
        const hash = await hashPassword(password);
        const { lastInsertRowid } = db
          .prepare('INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)')
          .run(email, hash, now());
        startSession(ctx.res, Number(lastInsertRowid));
        return toMe(userById(Number(lastInsertRowid))!);
      },
    ],

    [
      'POST',
      /^\/api\/auth\/login$/,
      async (ctx) => {
        if (!loginLimit.hit(ctx.ip)) throw new ApiError(429, 'rate_limited');
        const b = await ctx.body();
        const email = normalizeEmail(str(b.email, 300) ?? '');
        const password = str(b.password, MAX_PASSWORD) ?? '';
        const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
        if (!u || !(await verifyPassword(password, u.password_hash))) throw new ApiError(401, 'bad_credentials');
        startSession(ctx.res, u.id);
        return toMe(u);
      },
    ],

    [
      'POST',
      /^\/api\/auth\/logout$/,
      (ctx) => {
        const token = sessionToken(ctx.req);
        if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
        setCookie(ctx.res, '', 0);
        return { ok: true };
      },
    ],

    [
      'POST',
      /^\/api\/auth\/password$/,
      async (ctx) => {
        const u = requireUser(ctx);
        const b = await ctx.body();
        if (!(await verifyPassword(str(b.current, MAX_PASSWORD) ?? '', u.password_hash)))
          throw new ApiError(401, 'bad_credentials');
        const next = checkPassword(b.next);
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(next), u.id);
        // Log out everywhere else.
        const keep = tokenHash(sessionToken(ctx.req)!);
        db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(u.id, keep);
        return { ok: true };
      },
    ],

    [
      'GET',
      /^\/api\/me$/,
      (ctx) => {
        const u = currentUser(ctx);
        return { user: u ? toMe(u) : null };
      },
    ],

    // ---- admin ----

    [
      'GET',
      /^\/api\/admin\/users$/,
      (ctx) => {
        requireAdmin(ctx);
        const q = (ctx.query.get('q') ?? '').trim();
        const id = q ? idFromCode(q) : null;
        const rows = (
          !q
            ? db.prepare('SELECT * FROM users ORDER BY id DESC LIMIT 50').all()
            : db
                .prepare('SELECT * FROM users WHERE email LIKE ? OR id = ? ORDER BY id DESC LIMIT 50')
                .all(`%${q.toLowerCase().replace(/[%_]/g, '')}%`, id ?? -1)
        ) as unknown as UserRow[];
        return { users: rows.map(adminUser) };
      },
    ],

    [
      'POST',
      /^\/api\/admin\/users\/(\d+)\/grant$/,
      async (ctx, [id]) => {
        const admin = requireAdmin(ctx);
        const u = targetUser(id);
        const b = await ctx.body();
        const months = int(b.months, 1, 36);
        if (months == null) throw new ApiError(400, 'bad_request');
        const amount = b.amountToman == null ? 0 : int(b.amountToman, 0, 1e12);
        if (amount == null) throw new ApiError(400, 'bad_request');
        const note = str(b.note ?? '', 500);
        if (note == null) throw new ApiError(400, 'bad_request');
        // A renewal before expiry extends the current pass instead of starting from today.
        const until = addMonths(Math.max(now(), u.pro_until ?? 0), months);
        db.prepare('UPDATE users SET pro_until = ? WHERE id = ?').run(until, u.id);
        db.prepare(
          'INSERT INTO grants (user_id, admin_id, months, amount_toman, note, pro_until, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ).run(u.id, admin.id, months, amount, note, until, now());
        return { user: adminUser(userById(u.id)!) };
      },
    ],

    [
      'POST',
      /^\/api\/admin\/users\/(\d+)\/revoke$/,
      async (ctx, [id]) => {
        const admin = requireAdmin(ctx);
        const u = targetUser(id);
        const b = await ctx.body();
        db.prepare('UPDATE users SET pro_until = NULL WHERE id = ?').run(u.id);
        db.prepare(
          'INSERT INTO grants (user_id, admin_id, months, amount_toman, note, pro_until, created_at) VALUES (?, ?, 0, 0, ?, NULL, ?)',
        ).run(u.id, admin.id, str(b.note ?? '', 500) ?? '', now());
        return { user: adminUser(userById(u.id)!) };
      },
    ],

    [
      'POST',
      /^\/api\/admin\/users\/(\d+)\/reset-password$/,
      async (ctx, [id]) => {
        requireAdmin(ctx);
        const u = targetUser(id);
        const password = tempPassword();
        db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), u.id);
        db.prepare('DELETE FROM sessions WHERE user_id = ?').run(u.id);
        return { password };
      },
    ],

    [
      'GET',
      /^\/api\/admin\/grants$/,
      (ctx) => {
        requireAdmin(ctx);
        const rows = db
          .prepare(
            `SELECT g.id, g.user_id, u.email, g.months, g.amount_toman, g.note, g.pro_until, g.created_at
             FROM grants g JOIN users u ON u.id = g.user_id ORDER BY g.id DESC LIMIT 100`,
          )
          .all() as unknown as {
          id: number;
          user_id: number;
          email: string;
          months: number;
          amount_toman: number;
          note: string;
          pro_until: number | null;
          created_at: number;
        }[];
        return {
          grants: rows.map((g) => ({
            id: g.id,
            userId: g.user_id,
            code: userCode(g.user_id),
            email: g.email,
            months: g.months,
            amountToman: g.amount_toman,
            note: g.note,
            proUntil: g.pro_until,
            createdAt: g.created_at,
          })),
        };
      },
    ],
  ];

  function clientIp(req: IncomingMessage) {
    if (opts.trustProxy) {
      // nginx passes on what Caddy set; the last entry is the one our own proxy added.
      const xff = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return req.socket.remoteAddress ?? '';
  }

  function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    // JSON only: a cross-site form cannot send it without a CORS preflight we never answer.
    if (!String(req.headers['content-type'] ?? '').startsWith('application/json'))
      return Promise.reject(new ApiError(415, 'bad_request'));
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          reject(new ApiError(413, 'bad_request'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        try {
          const v = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
          if (v && typeof v === 'object' && !Array.isArray(v)) resolve(v);
          else reject(new ApiError(400, 'bad_request'));
        } catch {
          reject(new ApiError(400, 'bad_request'));
        }
      });
      req.on('error', reject);
    });
  }

  function send(res: ServerResponse, status: number, data: unknown) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(data));
  }

  return async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? '/', 'http://local');
    const method = req.method ?? 'GET';
    let body: Promise<Record<string, unknown>> | null = null;
    const ctx: Ctx = {
      req,
      res,
      method,
      path: url.pathname,
      query: url.searchParams,
      ip: clientIp(req),
      body: () => (body ??= readBody(req)),
    };
    try {
      let pathMatched = false;
      for (const [m, re, handler] of routes) {
        const match = re.exec(ctx.path);
        if (!match) continue;
        pathMatched = true;
        if (m !== method) continue;
        if (method === 'POST') await ctx.body(); // reject non-JSON before doing anything
        return send(res, 200, await handler(ctx, match.slice(1)));
      }
      throw new ApiError(pathMatched ? 405 : 404, pathMatched ? 'bad_request' : 'not_found');
    } catch (e) {
      if (e instanceof ApiError) return send(res, e.status, { error: e.code });
      console.error(e);
      return send(res, 500, { error: 'server_error' });
    }
  };
}
