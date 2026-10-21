// node --test server/src  (npm run test:api)
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { SESSION_MS, createApp } from './app.ts';
import { addMonths, idFromCode, openDb, userCode, type Db } from './db.ts';

let db: Db;
let server: Server;
let base: string;
let clock = Date.UTC(2026, 0, 15);
/** A fresh app per test, so rate limits do not carry over. */
let handle: ReturnType<typeof createApp>;

before(async () => {
  db = openDb(':memory:');
  server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  db.exec('DELETE FROM grants; DELETE FROM sessions; DELETE FROM users;');
  clock = Date.UTC(2026, 0, 15);
  handle = createApp({ db, now: () => clock });
});

/** A tiny client that keeps its own session cookie. */
function client() {
  let cookie = '';
  return async (method: string, path: string, body?: unknown, contentType = 'application/json') => {
    const r = await fetch(base + path, {
      method,
      headers: { ...(cookie ? { cookie } : {}), ...(body !== undefined ? { 'content-type': contentType } : {}) },
      body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
    });
    const set = r.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- loose JSON in tests
    const data = (await r.json()) as Record<string, any>;
    return { status: r.status, data, setCookie: set };
  };
}

async function registered(email = 'a@example.com', password = 'password1') {
  const c = client();
  const r = await c('POST', '/api/auth/register', { email, password });
  assert.equal(r.status, 200);
  return { c, me: r.data };
}

async function admin() {
  const a = await registered('owner@example.com');
  db.prepare('UPDATE users SET is_admin = 1 WHERE email = ?').run('owner@example.com');
  return a.c;
}

describe('accounts', () => {
  it('registers, normalizes the email and starts a session', async () => {
    const c = client();
    const r = await c('POST', '/api/auth/register', { email: '  Me@Example.COM ', password: 'password1' });
    assert.equal(r.status, 200);
    assert.equal(r.data.email, 'me@example.com');
    assert.equal(r.data.plan, 'free');
    assert.equal(r.data.code, userCode(r.data.id));
    assert.match(r.setCookie!, /HttpOnly/);
    const me = await c('GET', '/api/me');
    assert.equal(me.data.user.email, 'me@example.com');
  });

  it('rejects bad input and duplicates', async () => {
    const c = client();
    assert.equal((await c('POST', '/api/auth/register', { email: 'nope', password: 'password1' })).data.error, 'invalid_email');
    assert.equal((await c('POST', '/api/auth/register', { email: 'x@y.co', password: 'short' })).data.error, 'weak_password');
    await registered('x@y.co');
    const dup = await c('POST', '/api/auth/register', { email: 'X@y.co', password: 'password1' });
    assert.deepEqual([dup.status, dup.data.error], [409, 'email_taken']);
  });

  it('accepts JSON bodies only', async () => {
    const c = client();
    const r = await c('POST', '/api/auth/login', 'email=a@example.com', 'application/x-www-form-urlencoded');
    assert.equal(r.status, 415);
  });

  it('logs in and out', async () => {
    await registered();
    const c = client();
    assert.equal((await c('POST', '/api/auth/login', { email: 'a@example.com', password: 'wrong-pass' })).data.error, 'bad_credentials');
    assert.equal((await c('POST', '/api/auth/login', { email: 'A@example.com', password: 'password1' })).status, 200);
    assert.ok((await c('GET', '/api/me')).data.user);
    await c('POST', '/api/auth/logout', {});
    assert.equal((await c('GET', '/api/me')).data.user, null);
  });

  it('expires sessions after 30 days without use, renews them when used', async () => {
    const { c } = await registered();
    clock += SESSION_MS - 1000;
    assert.ok((await c('GET', '/api/me')).data.user, 'still valid, and renewed');
    clock += SESSION_MS - 1000;
    assert.ok((await c('GET', '/api/me')).data.user, 'renewed by the previous call');
    clock += SESSION_MS + 1;
    assert.equal((await c('GET', '/api/me')).data.user, null);
  });

  it('changes the password and logs out other sessions', async () => {
    const { c } = await registered();
    const other = client();
    await other('POST', '/api/auth/login', { email: 'a@example.com', password: 'password1' });
    assert.equal((await c('POST', '/api/auth/password', { current: 'nope', next: 'password2' })).data.error, 'bad_credentials');
    assert.equal((await c('POST', '/api/auth/password', { current: 'password1', next: 'password2' })).status, 200);
    assert.ok((await c('GET', '/api/me')).data.user);
    assert.equal((await other('GET', '/api/me')).data.user, null);
    assert.equal((await client()('POST', '/api/auth/login', { email: 'a@example.com', password: 'password2' })).status, 200);
  });

  it('rate-limits registration per IP', async () => {
    const c = client();
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) codes.push((await c('POST', '/api/auth/register', { email: `r${i}@x.io`, password: 'password1' })).status);
    assert.deepEqual(codes, [200, 200, 200, 200, 200, 429, 429]);
  });
});

describe('admin', () => {
  it('is admin-only', async () => {
    const { c } = await registered();
    assert.equal((await c('GET', '/api/admin/users')).status, 403);
    assert.equal((await client()('GET', '/api/admin/users')).status, 401);
  });

  it('grants Pro, extends from the current expiry, revokes', async () => {
    const { me } = await registered('buyer@example.com');
    const a = await admin();
    const g1 = await a('POST', `/api/admin/users/${me.id}/grant`, { months: 1, amountToman: 200000, note: 'card' });
    assert.equal(g1.data.user.plan, 'pro');
    assert.equal(g1.data.user.proUntil, addMonths(clock, 1));
    clock += 10 * 86_400_000; // renew 10 days in: adds to the remaining time
    const g2 = await a('POST', `/api/admin/users/${me.id}/grant`, { months: 3 });
    assert.equal(g2.data.user.proUntil, addMonths(addMonths(Date.UTC(2026, 0, 15), 1), 3));
    const grants = await a('GET', '/api/admin/grants');
    assert.equal(grants.data.grants.length, 2);
    assert.equal(grants.data.grants[1].amountToman, 200000); // newest first
    const r = await a('POST', `/api/admin/users/${me.id}/revoke`, {});
    assert.equal(r.data.user.plan, 'free');
    assert.equal((await a('POST', `/api/admin/users/${me.id}/grant`, { months: 0 })).status, 400);
  });

  it('Pro ends by itself when the pass runs out', async () => {
    const { c, me } = await registered('buyer@example.com');
    const a = await admin();
    await a('POST', `/api/admin/users/${me.id}/grant`, { months: 1 });
    assert.equal((await c('GET', '/api/me')).data.user.plan, 'pro');
    const end = addMonths(clock, 1);
    clock += 20 * 86_400_000;
    assert.equal((await c('GET', '/api/me')).data.user.plan, 'pro'); // also keeps the session alive
    clock = end + 1;
    assert.equal((await c('GET', '/api/me')).data.user.plan, 'free');
  });

  it('finds users by email or code', async () => {
    const { me } = await registered('findme@example.com');
    const a = await admin();
    assert.equal((await a('GET', '/api/admin/users?q=findme')).data.users[0].id, me.id);
    assert.equal((await a('GET', `/api/admin/users?q=${me.code}`)).data.users[0].id, me.id);
    assert.equal((await a('GET', '/api/admin/users')).data.users.length, 2);
  });

  it('resets a password to a one-time password and logs the user out', async () => {
    const { c, me } = await registered();
    const a = await admin();
    const r = await a('POST', `/api/admin/users/${me.id}/reset-password`, {});
    assert.match(r.data.password, /^[A-Za-z2-9]{10}$/);
    assert.equal((await c('GET', '/api/me')).data.user, null);
    assert.equal((await client()('POST', '/api/auth/login', { email: 'a@example.com', password: r.data.password })).status, 200);
  });
});

describe('codes', () => {
  it('round-trips user codes', () => {
    assert.equal(userCode(42), 'U-1042');
    assert.equal(idFromCode('U-1042'), 42);
    assert.equal(idFromCode('u1042'), 42);
    assert.equal(idFromCode('hello'), null);
  });
});
