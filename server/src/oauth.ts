// OAuth 2.1 for AI apps that connect to /mcp (the MCP authorization spec): discovery documents,
// dynamic client registration, an authorize page where the user logs in and allows the app, and
// tokens (PKCE S256 only; refresh tokens rotate). Tokens are stored as SHA-256 hashes like sessions.
import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { newToken, tokenHash } from './auth.ts';
import type { Db } from './db.ts';

const MINUTE = 60_000;
export const CODE_MS = 10 * MINUTE;
export const ACCESS_MS = 60 * MINUTE;
export const REFRESH_MS = 60 * 24 * 60 * MINUTE;
export const SCOPE = 'editor';
const CSRF_COOKIE = 've_oauth';

export interface OAuthDeps {
  db: Db;
  now: () => number;
  /** https://editor.example.com (no trailing slash). */
  baseUrl: (req: IncomingMessage) => string;
  secureCookies?: boolean;
  /** The logged-in user from the session cookie. */
  sessionUser: (req: IncomingMessage, res: ServerResponse) => { id: number; email: string } | null;
  /** Check a password and start a session; false when wrong or rate limited. */
  login: (req: IncomingMessage, res: ServerResponse, email: string, password: string) => Promise<boolean>;
}

interface ClientRow {
  client_id: string;
  secret_hash: string | null;
  name: string;
  redirect_uris: string;
}

/** An error the token and register endpoints report in RFC 6749 form. */
export class OAuthError extends Error {
  readonly status: number;
  readonly error: string;
  constructor(status: number, error: string, description?: string) {
    super(description ?? error);
    this.status = status;
    this.error = error;
  }
}

const sha256url = (s: string) => createHash('sha256').update(s).digest('base64url');

/** https anywhere, http only to this machine, or an app's own scheme (cursor://…); never script-like schemes. */
export function allowedRedirect(uri: string): boolean {
  let u: URL;
  try {
    u = new URL(uri);
  } catch {
    return false;
  }
  if (u.hash) return false;
  if (u.protocol === 'https:') return true;
  if (u.protocol === 'http:') return ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
  return /^[a-z][a-z0-9+.-]*:$/.test(u.protocol) && !['javascript:', 'data:', 'vbscript:', 'file:', 'blob:', 'about:'].includes(u.protocol);
}

export function createOAuth(deps: OAuthDeps) {
  const { db, now } = deps;

  const client = (id: string) => db.prepare('SELECT * FROM oauth_clients WHERE client_id = ?').get(id) as ClientRow | undefined;

  function metadata(req: IncomingMessage) {
    const base = deps.baseUrl(req);
    return {
      issuer: base,
      authorization_endpoint: `${base}/oauth/authorize`,
      token_endpoint: `${base}/oauth/token`,
      registration_endpoint: `${base}/oauth/register`,
      revocation_endpoint: `${base}/oauth/revoke`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
      scopes_supported: [SCOPE],
    };
  }

  const resourceMetadata = (req: IncomingMessage) => {
    const base = deps.baseUrl(req);
    return { resource: `${base}/mcp`, authorization_servers: [base], scopes_supported: [SCOPE], bearer_methods_supported: ['header'], resource_name: 'Vidora' };
  };

  /** RFC 7591. */
  function register(body: Record<string, unknown>) {
    const uris = body.redirect_uris;
    if (!Array.isArray(uris) || !uris.length || uris.length > 10 || !uris.every((u) => typeof u === 'string' && u.length <= 2000 && allowedRedirect(u)))
      throw new OAuthError(400, 'invalid_redirect_uri', 'redirect_uris must be https, http://localhost or an app scheme');
    const method = body.token_endpoint_auth_method ?? 'none';
    if (method !== 'none' && method !== 'client_secret_post' && method !== 'client_secret_basic')
      throw new OAuthError(400, 'invalid_client_metadata', 'unsupported token_endpoint_auth_method');
    const name = (typeof body.client_name === 'string' && body.client_name.trim().slice(0, 100)) || 'AI app';
    const clientId = newToken();
    const secret = method === 'none' ? null : newToken();
    db.prepare('INSERT INTO oauth_clients (client_id, secret_hash, name, redirect_uris, created_at) VALUES (?, ?, ?, ?, ?)').run(
      clientId,
      secret && tokenHash(secret),
      name,
      JSON.stringify(uris),
      now(),
    );
    return {
      client_id: clientId,
      ...(secret && { client_secret: secret, client_secret_expires_at: 0 }),
      client_id_issued_at: Math.floor(now() / 1000),
      client_name: name,
      redirect_uris: uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: method,
    };
  }

  // ---- authorize page ----

  interface AuthRequest {
    client: ClientRow;
    redirectUri: string;
    challenge: string;
    state: string | null;
  }

  /** Check an authorize request. Errors before the redirect URI is trusted are shown on the page. */
  function authRequest(q: URLSearchParams): AuthRequest | { pageError: string } | { redirectError: string; redirectUri: string; state: string | null } {
    const c = client(q.get('client_id') ?? '');
    if (!c) return { pageError: 'This app is not registered. Remove it from your AI app and add Vidora again.' };
    const redirectUri = q.get('redirect_uri') ?? '';
    if (!(JSON.parse(c.redirect_uris) as string[]).includes(redirectUri)) return { pageError: 'The app sent an address that it did not register.' };
    const state = q.get('state');
    if (q.get('response_type') !== 'code') return { redirectError: 'unsupported_response_type', redirectUri, state };
    const challenge = q.get('code_challenge') ?? '';
    if (q.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43}$/.test(challenge)) return { redirectError: 'invalid_request', redirectUri, state };
    return { client: c, redirectUri, challenge, state };
  }

  function redirectTo(res: ServerResponse, uri: string, params: Record<string, string | null>) {
    const u = new URL(uri);
    for (const [k, v] of Object.entries(params)) if (v != null) u.searchParams.set(k, v);
    res.statusCode = 302;
    res.setHeader('Location', u.toString());
    res.setHeader('Cache-Control', 'no-store');
    res.end();
  }

  function csrfToken(req: IncomingMessage, res: ServerResponse) {
    const existing = cookie(req, CSRF_COOKIE);
    if (existing) return existing;
    const token = newToken();
    res.setHeader('Set-Cookie', [`${CSRF_COOKIE}=${token}`, 'Path=/oauth', 'HttpOnly', 'SameSite=Strict', ...(deps.secureCookies ? ['Secure'] : [])].join('; '));
    return token;
  }

  /** GET /oauth/authorize, and POST (login, allow, deny) from its own form. */
  async function authorize(req: IncomingMessage, res: ServerResponse, query: URLSearchParams, form: URLSearchParams | null) {
    const fa = /^fa\b/i.test(String(req.headers['accept-language'] ?? ''));
    const L = fa ? FA : EN;
    const params = form ?? query;
    const ar = authRequest(params);
    if ('pageError' in ar) return page(res, 400, L, `<p class="err">${esc(ar.pageError)}</p>`);
    if ('redirectError' in ar) return redirectTo(res, ar.redirectUri, { error: ar.redirectError, state: ar.state });

    let loginError = '';
    if (form) {
      const csrf = cookie(req, CSRF_COOKIE);
      if (!csrf || !safeEqual(csrf, form.get('csrf') ?? '')) return page(res, 400, L, `<p class="err">${L.expired}</p>`);
      const action = form.get('action');
      if (action === 'deny') return redirectTo(res, ar.redirectUri, { error: 'access_denied', state: ar.state });
      if (action === 'login' && !(await deps.login(req, res, form.get('email') ?? '', form.get('password') ?? ''))) loginError = L.badLogin;
      if (action === 'allow') {
        const user = deps.sessionUser(req, res);
        if (user) {
          const code = newToken();
          db.prepare('INSERT INTO oauth_codes (code_hash, client_id, user_id, redirect_uri, challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)').run(
            tokenHash(code),
            ar.client.client_id,
            user.id,
            ar.redirectUri,
            ar.challenge,
            now() + CODE_MS,
          );
          return redirectTo(res, ar.redirectUri, { code, state: ar.state, iss: deps.baseUrl(req) });
        }
      }
    }

    const csrf = csrfToken(req, res);
    const user = deps.sessionUser(req, res);
    const hidden = ['client_id', 'redirect_uri', 'response_type', 'code_challenge', 'code_challenge_method', 'state', 'scope', 'resource']
      .map((k) => (params.get(k) != null ? `<input type="hidden" name="${k}" value="${esc(params.get(k)!)}">` : ''))
      .join('') + `<input type="hidden" name="csrf" value="${esc(csrf)}">`;
    const app = `<b dir="auto">${esc(ar.client.name)}</b>`;
    const body = user
      ? `<p>${L.wants(app)}</p><ul>${L.can.map((x) => `<li>${x}</li>`).join('')}</ul>
         <p class="muted">${L.as(`<span dir="ltr">${esc(user.email)}</span>`)}</p>
         <form method="post">${hidden}<div class="row">
           <button name="action" value="deny" class="ghost">${L.deny}</button>
           <button name="action" value="allow" class="primary">${L.allow}</button></div></form>`
      : `<p>${L.loginFirst(app)}</p>${loginError ? `<p class="err">${loginError}</p>` : ''}
         <form method="post">${hidden}<input type="hidden" name="action" value="login">
           <label>${L.email}<input name="email" type="email" autocomplete="email" required dir="ltr"></label>
           <label>${L.password}<input name="password" type="password" autocomplete="current-password" required dir="ltr"></label>
           <div class="row"><button class="primary">${L.login}</button></div></form>
         <p class="muted">${L.noAccount}</p>`;
    return page(res, 200, L, body);
  }

  // ---- tokens ----

  function issue(clientId: string, userId: number) {
    const access = newToken();
    const refresh = newToken();
    const t = now();
    const insert = db.prepare('INSERT INTO oauth_tokens (token_hash, kind, client_id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    insert.run(tokenHash(access), 'access', clientId, userId, t + ACCESS_MS, t);
    insert.run(tokenHash(refresh), 'refresh', clientId, userId, t + REFRESH_MS, t);
    db.prepare('DELETE FROM oauth_tokens WHERE expires_at <= ?').run(t);
    db.prepare('DELETE FROM oauth_codes WHERE expires_at <= ?').run(t);
    return { access_token: access, token_type: 'Bearer', expires_in: ACCESS_MS / 1000, refresh_token: refresh, scope: SCOPE };
  }

  /** The client making a token request, its secret checked when it has one. */
  function authenticate(req: IncomingMessage, form: URLSearchParams): ClientRow {
    let id = form.get('client_id') ?? '';
    let secret = form.get('client_secret');
    const basic = /^Basic\s+(.+)$/i.exec(String(req.headers.authorization ?? ''));
    if (basic) {
      const [u, p] = Buffer.from(basic[1], 'base64').toString('utf8').split(':');
      id = decodeURIComponent(u ?? '');
      secret = decodeURIComponent(p ?? '');
    }
    const c = client(id);
    if (!c) throw new OAuthError(401, 'invalid_client');
    if (c.secret_hash && (!secret || !safeEqual(c.secret_hash, tokenHash(secret)))) throw new OAuthError(401, 'invalid_client');
    return c;
  }

  function token(req: IncomingMessage, form: URLSearchParams) {
    const c = authenticate(req, form);
    const grant = form.get('grant_type');
    if (grant === 'authorization_code') {
      const hash = tokenHash(form.get('code') ?? '');
      const row = db.prepare('SELECT * FROM oauth_codes WHERE code_hash = ?').get(hash) as
        | { client_id: string; user_id: number; redirect_uri: string; challenge: string; expires_at: number }
        | undefined;
      // Single use, whatever happens next.
      db.prepare('DELETE FROM oauth_codes WHERE code_hash = ?').run(hash);
      if (!row || row.expires_at <= now() || row.client_id !== c.client_id) throw new OAuthError(400, 'invalid_grant');
      if (form.get('redirect_uri') !== null && form.get('redirect_uri') !== row.redirect_uri) throw new OAuthError(400, 'invalid_grant');
      const verifier = form.get('code_verifier') ?? '';
      if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !safeEqual(sha256url(verifier), row.challenge)) throw new OAuthError(400, 'invalid_grant', 'PKCE check failed');
      return issue(c.client_id, row.user_id);
    }
    if (grant === 'refresh_token') {
      const hash = tokenHash(form.get('refresh_token') ?? '');
      const row = db.prepare("SELECT * FROM oauth_tokens WHERE token_hash = ? AND kind = 'refresh'").get(hash) as
        | { client_id: string; user_id: number; expires_at: number }
        | undefined;
      if (!row || row.expires_at <= now() || row.client_id !== c.client_id) throw new OAuthError(400, 'invalid_grant');
      db.prepare('DELETE FROM oauth_tokens WHERE token_hash = ?').run(hash);
      return issue(c.client_id, row.user_id);
    }
    throw new OAuthError(400, 'unsupported_grant_type');
  }

  /** RFC 7009: always 200, whether or not the token existed. */
  function revoke(form: URLSearchParams) {
    db.prepare('DELETE FROM oauth_tokens WHERE token_hash = ?').run(tokenHash(form.get('token') ?? ''));
  }

  /** The user and app behind an `Authorization: Bearer` access token, or null. */
  function bearer(req: IncomingMessage): { userId: number; clientId: string } | null {
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization ?? ''));
    if (!m) return null;
    const hash = tokenHash(m[1]);
    const row = db.prepare("SELECT client_id, user_id, expires_at, last_used_at FROM oauth_tokens WHERE token_hash = ? AND kind = 'access'").get(hash) as
      | { client_id: string; user_id: number; expires_at: number; last_used_at: number | null }
      | undefined;
    if (!row || row.expires_at <= now()) return null;
    if (!row.last_used_at || now() - row.last_used_at > MINUTE) db.prepare('UPDATE oauth_tokens SET last_used_at = ? WHERE token_hash = ?').run(now(), hash);
    return { userId: row.user_id, clientId: row.client_id };
  }

  /** Apps with a live token for this user (the editor's "Connected apps"). */
  function apps(userId: number) {
    const rows = db
      .prepare(
        `SELECT c.client_id, c.name, MIN(t.created_at) AS connected_at, MAX(t.last_used_at) AS last_used_at
         FROM oauth_tokens t JOIN oauth_clients c ON c.client_id = t.client_id
         WHERE t.user_id = ? AND t.expires_at > ? GROUP BY c.client_id ORDER BY connected_at DESC`,
      )
      .all(userId, now()) as unknown as { client_id: string; name: string; connected_at: number; last_used_at: number | null }[];
    return rows.map((r) => ({ clientId: r.client_id, name: r.name, connectedAt: r.connected_at, lastUsedAt: r.last_used_at }));
  }

  const disconnect = (userId: number, clientId: string) => db.prepare('DELETE FROM oauth_tokens WHERE user_id = ? AND client_id = ?').run(userId, clientId);
  const disconnectAll = (userId: number) => db.prepare('DELETE FROM oauth_tokens WHERE user_id = ?').run(userId);

  return { metadata, resourceMetadata, register, authorize, token, revoke, bearer, apps, disconnect, disconnectAll };
}

export type OAuth = ReturnType<typeof createOAuth>;

// ---- helpers ----

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function cookie(req: IncomingMessage, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=') || null;
  }
  return null;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const EN = {
  dir: 'ltr',
  lang: 'en',
  title: 'Connect to Vidora',
  wants: (app: string) => `${app} wants to use your Vidora editor.`,
  can: ['Read and edit the project open in your Vidora tab, while you allow agent access there', 'Make captions and open the export window (you still press Export)'],
  as: (email: string) => `Signed in as ${email}. You can disconnect the app any time under "AI agent".`,
  allow: 'Allow',
  deny: 'Cancel',
  loginFirst: (app: string) => `Log in to Vidora to connect ${app}.`,
  email: 'Email',
  password: 'Password',
  login: 'Log in',
  noAccount: 'No account yet? Create one in the editor first, then come back.',
  badLogin: 'Wrong email or password (or too many tries; wait a few minutes).',
  expired: 'This page expired. Start connecting again from your AI app.',
};

const FA: typeof EN = {
  dir: 'rtl',
  lang: 'fa',
  title: 'اتصال به ویدورا',
  wants: (app) => `${app} می‌خواهد از ویرایشگر ویدورای شما استفاده کند.`,
  can: ['خواندن و ویرایش پروژهٔ باز در زبانهٔ ویدورا، تا وقتی آنجا اجازهٔ دسترسی بدهید', 'ساخت زیرنویس و باز کردن پنجرهٔ خروجی (دکمهٔ خروجی را خودتان می‌زنید)'],
  as: (email) => `وارد شده با ${email}. هر وقت بخواهید از «دستیار هوش مصنوعی» اتصال را قطع کنید.`,
  allow: 'اجازه بده',
  deny: 'انصراف',
  loginFirst: (app) => `برای اتصال ${app} وارد ویدورا شوید.`,
  email: 'ایمیل',
  password: 'رمز عبور',
  login: 'ورود',
  noAccount: 'حساب ندارید؟ اول در ویرایشگر حساب بسازید و برگردید.',
  badLogin: 'ایمیل یا رمز اشتباه است (یا تلاش‌ها زیاد بوده؛ چند دقیقه صبر کنید).',
  expired: 'این صفحه منقضی شده. اتصال را از برنامهٔ هوش مصنوعی دوباره شروع کنید.',
};

function page(res: ServerResponse, status: number, L: typeof EN, body: string) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  // Never inside someone else's frame (clickjacking the Allow button).
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'");
  res.end(`<!doctype html><html lang="${L.lang}" dir="${L.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${L.title}</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b1514;color:#e6f2ef;font:15px/1.5 system-ui,Tahoma,sans-serif}
main{width:min(420px,92vw);background:#12201e;border:1px solid #23413c;border-radius:12px;padding:20px 22px}
h1{font-size:18px;margin:0 0 12px;color:#5eead4}ul{padding-inline-start:20px}.muted{color:#8fb3ad;font-size:13px}.err{color:#f87171}
label{display:block;margin:10px 0;font-size:13px;color:#8fb3ad}input{display:block;box-sizing:border-box;width:100%;margin-top:4px;padding:8px;border-radius:6px;border:1px solid #23413c;background:#0b1514;color:inherit;font:inherit}
.row{display:flex;gap:8px;justify-content:flex-end;margin-top:14px}button{padding:8px 16px;border-radius:6px;border:1px solid #23413c;font:inherit;cursor:pointer}
.primary{background:#2dd4bf;color:#04201c;border-color:#2dd4bf;font-weight:600}.ghost{background:transparent;color:inherit}
</style></head><body><main><h1>${L.title}</h1>${body}</main></body></html>`);
}
