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
import { Bridge } from './bridge.ts';
import { addCredits, ChatError, createChat } from './chat.ts';
import { addMonths, idFromCode, userCode, type Db, type UserRow } from './db.ts';
import { handleRpc } from './mcp.ts';
import { createOAuth, OAuthError } from './oauth.ts';
import { RateLimiter } from './rateLimit.ts';

export const COOKIE = 've_session';
const DAY = 86_400_000;
export const SESSION_MS = 30 * DAY;
const MAX_BODY = 16 * 1024;
/** Bigger bodies: tool results (snapshots are pictures) and MCP calls (SRT text). */
const BODY_LIMITS: Record<string, number> = {
  '/api/bridge/result': 4 * 1024 * 1024,
  '/mcp': 1024 * 1024,
  // The whole chat so far, with up to four pictures.
  '/api/chat/turn': 8 * 1024 * 1024,
};
const VERSION = '1.0.0';

export interface AppOptions {
  db: Db;
  now?: () => number;
  /** Send the cookie with `Secure` (production). Off for plain-http local dev. */
  secureCookies?: boolean;
  /** Read the client IP from X-Forwarded-For (behind Caddy → nginx). */
  trustProxy?: boolean;
  /** The editor's public address, e.g. https://editor.example.com (OAuth issuer, MCP resource). Default: from the Host header. */
  publicUrl?: string;
  bridge?: Bridge;
  /** The built-in AI chat (chat.ts); off when absent. */
  chat?: ReturnType<typeof createChat>;
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
  /** AI chat credits (chat.ts). */
  credits: number;
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
    credits: u.credits,
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

  /** Check the password and start a session (the login route and the OAuth page). */
  async function logIn(ip: string, res: ServerResponse, rawEmail: unknown, rawPassword: unknown): Promise<UserRow> {
    if (!loginLimit.hit(ip)) throw new ApiError(429, 'rate_limited');
    const email = normalizeEmail(str(rawEmail, 300) ?? '');
    const password = str(rawPassword, MAX_PASSWORD) ?? '';
    const u = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
    if (!u || !(await verifyPassword(password, u.password_hash))) throw new ApiError(401, 'bad_credentials');
    startSession(res, u.id);
    return u;
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

  const bridge = opts.bridge ?? new Bridge();
  const baseUrl = (req: IncomingMessage) => opts.publicUrl?.replace(/\/+$/, '') ?? `http://${req.headers.host ?? 'localhost'}`;
  const oauth = createOAuth({
    db,
    now,
    baseUrl,
    secureCookies: opts.secureCookies,
    sessionUser: (req, res) => currentUser({ req, res } as Ctx),
    login: async (req, res, email, password) => {
      try {
        await logIn(clientIp(req), res, email, password);
        return true;
      } catch (e) {
        if (e instanceof ApiError) return false;
        throw e;
      }
    },
  });
  const clientLimit = new RateLimiter(20, 60 * 60_000, now);
  const mcpLimit = new RateLimiter(300, 60_000, now);
  const chatLimit = new RateLimiter(60, 60_000, now);
  const chatBusy = new Set<number>();

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
        const b = await ctx.body();
        return toMe(await logIn(ctx.ip, ctx.res, b.email, b.password));
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
        oauth.disconnectAll(u.id);
        return { ok: true };
      },
    ],

    [
      'GET',
      /^\/api\/me$/,
      (ctx) => {
        const u = currentUser(ctx);
        return { user: u ? toMe(u) : null, chat: !!opts.chat?.enabled };
      },
    ],

    // ---- AI agents (MCP) ----

    [
      'POST',
      /^\/api\/bridge\/result$/,
      async (ctx) => {
        const u = requireUser(ctx);
        const b = await ctx.body();
        const r = b.result as { content?: unknown } | null;
        // Passed on to the agent as an MCP tool result: it must at least look like one.
        if (!r || typeof r !== 'object' || !Array.isArray(r.content)) throw new ApiError(400, 'bad_request');
        if (!bridge.result(u.id, str(b.tabId, 100) ?? '', str(b.callId, 100) ?? '', r)) throw new ApiError(404, 'not_found');
        return { ok: true };
      },
    ],

    ['GET', /^\/api\/agent\/apps$/, (ctx) => ({ apps: oauth.apps(requireUser(ctx).id) })],

    [
      'POST',
      /^\/api\/agent\/apps\/revoke$/,
      async (ctx) => {
        const u = requireUser(ctx);
        oauth.disconnect(u.id, str((await ctx.body()).clientId, 200) ?? '');
        return { ok: true };
      },
    ],

    // ---- built-in AI chat ----

    [
      'POST',
      /^\/api\/chat\/turn$/,
      async (ctx) => {
        const u = requireUser(ctx);
        if (!opts.chat) throw new ApiError(503, 'ai_disabled');
        if (!chatLimit.hit(String(u.id))) throw new ApiError(429, 'rate_limited');
        // One turn at a time per user, so parallel turns cannot all pass the credit check.
        if (chatBusy.has(u.id)) throw new ApiError(409, 'busy');
        chatBusy.add(u.id);
        try {
          return await opts.chat.turn(u.id, (await ctx.body()).messages);
        } catch (e) {
          if (e instanceof ChatError) throw new ApiError(e.status, e.code);
          throw e;
        } finally {
          chatBusy.delete(u.id);
        }
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
      /^\/api\/admin\/users\/(\d+)\/credits$/,
      async (ctx, [id]) => {
        const admin = requireAdmin(ctx);
        const u = targetUser(id);
        const b = await ctx.body();
        // Negative takes credits back (a mistake, a refund paid out).
        const delta = int(b.credits, -10_000_000, 10_000_000);
        const amount = b.amountToman == null ? 0 : int(b.amountToman, 0, 1e12);
        const note = str(b.note ?? '', 500);
        if (!delta || amount == null || note == null) throw new ApiError(400, 'bad_request');
        addCredits(db, now(), { userId: u.id, delta, reason: delta > 0 ? 'grant' : 'refund', adminId: admin.id, amountToman: amount, note });
        return { user: adminUser(userById(u.id)!) };
      },
    ],

    [
      'GET',
      /^\/api\/admin\/users\/(\d+)\/credits$/,
      (ctx, [id]) => {
        requireAdmin(ctx);
        const u = targetUser(id);
        const rows = db
          .prepare('SELECT id, delta, reason, amount_toman, note, created_at FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 200')
          .all(u.id) as unknown as { id: number; delta: number; reason: string; amount_toman: number; note: string; created_at: number }[];
        return {
          entries: rows.map((r) => ({ id: r.id, delta: r.delta, reason: r.reason, amountToman: r.amount_toman, note: r.note, createdAt: r.created_at })),
        };
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
        oauth.disconnectAll(u.id);
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

  function readRaw(req: IncomingMessage, limit: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > limit) {
          reject(new ApiError(413, 'bad_request'));
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  const isJson = (req: IncomingMessage) => String(req.headers['content-type'] ?? '').startsWith('application/json');

  /** A JSON value (object, or array when `arrays`). */
  async function readJson(req: IncomingMessage, limit: number, arrays = false): Promise<unknown> {
    // JSON only: a cross-site form cannot send it without a CORS preflight we never answer.
    if (!isJson(req)) throw new ApiError(415, 'bad_request');
    let v: unknown;
    try {
      v = JSON.parse((await readRaw(req, limit)) || '{}');
    } catch {
      throw new ApiError(400, 'bad_request');
    }
    if (v && typeof v === 'object' && (arrays || !Array.isArray(v))) return v;
    throw new ApiError(400, 'bad_request');
  }

  const readBody = (req: IncomingMessage, limit: number) => readJson(req, limit) as Promise<Record<string, unknown>>;

  /** OAuth endpoints take forms (RFC 6749); JSON is accepted too. */
  async function readForm(req: IncomingMessage): Promise<URLSearchParams> {
    if (isJson(req)) {
      const o = await readBody(req, MAX_BODY);
      return new URLSearchParams(Object.entries(o).flatMap(([k, v]) => (typeof v === 'string' ? [[k, v]] : [])));
    }
    if (!String(req.headers['content-type'] ?? '').startsWith('application/x-www-form-urlencoded')) throw new ApiError(415, 'bad_request');
    return new URLSearchParams(await readRaw(req, MAX_BODY));
  }

  /** Endpoints AI apps reach from other origins (they authenticate with tokens, never cookies). */
  const isPublic = (path: string) =>
    path === '/mcp' || path.startsWith('/.well-known/oauth-') || path === '/oauth/register' || path === '/oauth/token' || path === '/oauth/revoke';

  /** MCP, OAuth and the bridge's event stream: not the JSON API's shape. True when handled. */
  async function special(ctx: Ctx): Promise<boolean> {
    const { req, res, method, path } = ctx;
    if (isPublic(path)) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id');
      res.setHeader('Access-Control-Expose-Headers', 'WWW-Authenticate, Mcp-Session-Id');
      if (method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return true;
      }
    }
    const oauthError = (e: unknown) => {
      if (!(e instanceof OAuthError)) throw e;
      send(res, e.status, { error: e.error, ...(e.message !== e.error && { error_description: e.message }) });
    };

    if (method === 'GET' && /^\/\.well-known\/oauth-protected-resource(\/mcp)?$/.test(path)) send(res, 200, oauth.resourceMetadata(req));
    else if (method === 'GET' && /^\/\.well-known\/(oauth-authorization-server|openid-configuration)$/.test(path)) send(res, 200, oauth.metadata(req));
    else if (path === '/oauth/register' && method === 'POST') {
      if (!clientLimit.hit(ctx.ip)) throw new ApiError(429, 'rate_limited');
      try {
        send(res, 201, oauth.register(await readBody(req, MAX_BODY)));
      } catch (e) {
        oauthError(e);
      }
    } else if (path === '/oauth/authorize' && (method === 'GET' || method === 'POST'))
      await oauth.authorize(req, res, ctx.query, method === 'POST' ? await readForm(req) : null);
    else if (path === '/oauth/token' && method === 'POST') {
      try {
        send(res, 200, oauth.token(req, await readForm(req)));
      } catch (e) {
        oauthError(e);
      }
    } else if (path === '/oauth/revoke' && method === 'POST') {
      oauth.revoke(await readForm(req));
      send(res, 200, {});
    } else if (path === '/mcp') await mcp(ctx);
    else if (path === '/api/bridge/stream' && method === 'GET') bridge.open(requireUser(ctx).id, res);
    else return false;
    return true;
  }

  async function mcp({ req, res, method }: Ctx) {
    const who = oauth.bearer(req);
    const u = who && userById(who.userId);
    if (!u) {
      res.setHeader('WWW-Authenticate', `Bearer resource_metadata="${baseUrl(req)}/.well-known/oauth-protected-resource"`);
      return send(res, 401, { error: 'invalid_token' });
    }
    if (method !== 'POST') {
      // No server-to-client stream: every answer is a plain JSON response.
      res.setHeader('Allow', 'POST');
      return send(res, 405, { error: 'method_not_allowed' });
    }
    if (!mcpLimit.hit(String(u.id))) return send(res, 429, { error: 'rate_limited' });
    let body: unknown;
    try {
      body = await readJson(req, BODY_LIMITS['/mcp'], true);
    } catch (e) {
      if (!(e instanceof ApiError) || e.status === 413) throw e;
      return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    }
    const user = { userId: u.id, plan: toMe(u).plan };
    const msgs = Array.isArray(body) ? body : [body];
    const out = (await Promise.all(msgs.map((m) => handleRpc(m, user, bridge, VERSION)))).filter((x) => x !== null);
    if (!out.length) {
      res.statusCode = 202;
      return res.end();
    }
    send(res, 200, Array.isArray(body) ? out : out[0]);
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
      body: () => (body ??= readBody(req, BODY_LIMITS[url.pathname] ?? MAX_BODY)),
    };
    try {
      if (await special(ctx)) return;
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
