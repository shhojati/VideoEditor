// node --test server/src  (npm run test:api): OAuth for AI apps, /mcp, and the relay to the tab.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';
import { createApp } from './app.ts';
import { Bridge } from './bridge.ts';
import { openDb, type Db } from './db.ts';
import { ACCESS_MS } from './oauth.ts';

let db: Db;
let server: Server;
let base: string;
let bridge: Bridge;
let clock = Date.UTC(2026, 9, 27);
let handle: ReturnType<typeof createApp>;
const REDIRECT = 'https://agent.example/callback';

before(async () => {
  db = openDb(':memory:');
  server = createServer((req, res) => void handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
after(() => {
  bridge?.close();
  return new Promise<void>((r) => server.close(() => r()));
});
beforeEach(() => {
  bridge?.close();
  db.exec('DELETE FROM oauth_tokens; DELETE FROM oauth_codes; DELETE FROM oauth_clients; DELETE FROM sessions; DELETE FROM users;');
  clock = Date.UTC(2026, 9, 27);
  bridge = new Bridge(500);
  handle = createApp({ db, now: () => clock, bridge });
});

const form = (o: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(o).toString(),
});

/** A logged-in browser: the session cookie. */
async function user(email = 'a@example.com') {
  const r = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email, password: 'password1' }),
  });
  return r.headers.get('set-cookie')!.split(';')[0];
}

/** What an AI app does: register, send the user to authorize, swap the code for tokens. */
async function connect(cookie: string, verifier = randomBytes(32).toString('base64url')) {
  const reg = await fetch(`${base}/oauth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ client_name: 'Test Agent', redirect_uris: [REDIRECT] }),
  });
  assert.equal(reg.status, 201);
  const { client_id } = (await reg.json()) as { client_id: string };
  const q = {
    response_type: 'code',
    client_id,
    redirect_uri: REDIRECT,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 'xyz',
  };
  const page = await fetch(`${base}/oauth/authorize?${new URLSearchParams(q)}`, { headers: { cookie } });
  assert.equal(page.status, 200);
  const html = await page.text();
  assert.match(html, /Test Agent/);
  const csrfCookie = page.headers.get('set-cookie')!.split(';')[0];
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1];
  const allow = await fetch(`${base}/oauth/authorize`, {
    ...form({ ...q, csrf, action: 'allow' }),
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: `${cookie}; ${csrfCookie}` },
    redirect: 'manual',
  });
  assert.equal(allow.status, 302);
  const to = new URL(allow.headers.get('location')!);
  assert.equal(to.origin + to.pathname, REDIRECT);
  assert.equal(to.searchParams.get('state'), 'xyz');
  return { client_id, code: to.searchParams.get('code')!, verifier };
}

async function tokens(c: { client_id: string; code: string; verifier: string }) {
  const r = await fetch(`${base}/oauth/token`, form({ grant_type: 'authorization_code', client_id: c.client_id, code: c.code, code_verifier: c.verifier, redirect_uri: REDIRECT }));
  return { status: r.status, data: (await r.json()) as Record<string, string> };
}

const rpc = (token: string, body: unknown) =>
  fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

describe('OAuth', () => {
  it('publishes discovery documents', async () => {
    const pr = (await (await fetch(`${base}/.well-known/oauth-protected-resource`)).json()) as Record<string, unknown>;
    assert.equal(pr.resource, `${base}/mcp`);
    const as = (await (await fetch(`${base}/.well-known/oauth-authorization-server`)).json()) as Record<string, unknown>;
    assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
  });

  it('connects an app: register → authorize → token → refresh', async () => {
    const cookie = await user();
    const c = await connect(cookie);
    const t = await tokens(c);
    assert.equal(t.status, 200);
    assert.equal(t.data.token_type, 'Bearer');
    // A code works once.
    assert.equal((await tokens(c)).status, 400);
    const refreshed = await fetch(`${base}/oauth/token`, form({ grant_type: 'refresh_token', client_id: c.client_id, refresh_token: t.data.refresh_token }));
    assert.equal(refreshed.status, 200);
    // The old refresh token is gone (rotation).
    const again = await fetch(`${base}/oauth/token`, form({ grant_type: 'refresh_token', client_id: c.client_id, refresh_token: t.data.refresh_token }));
    assert.equal(again.status, 400);
  });

  it('refuses a wrong PKCE verifier', async () => {
    const c = await connect(await user());
    const t = await tokens({ ...c, verifier: randomBytes(32).toString('base64url') });
    assert.equal(t.status, 400);
    assert.equal(t.data.error, 'invalid_grant');
  });

  it('refuses unsafe redirect addresses at registration', async () => {
    const r = await fetch(`${base}/oauth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ redirect_uris: ['javascript:alert(1)'] }),
    });
    assert.equal(r.status, 400);
  });

  it('asks for a login on the authorize page, and needs the CSRF token', async () => {
    const cookie = await user();
    const c = await connect(cookie); // registers a client we can reuse
    const q = { response_type: 'code', client_id: c.client_id, redirect_uri: REDIRECT, code_challenge: 'a'.repeat(43), code_challenge_method: 'S256' };
    const page = await fetch(`${base}/oauth/authorize?${new URLSearchParams(q)}`);
    assert.match(await page.text(), /name="password"/);
    const forged = await fetch(`${base}/oauth/authorize`, { ...form({ ...q, action: 'allow', csrf: 'x' }), redirect: 'manual' });
    assert.equal(forged.status, 400);
  });

  it('lists connected apps and disconnects them', async () => {
    const cookie = await user();
    const t = await tokens(await connect(cookie));
    const apps = (await (await fetch(`${base}/api/agent/apps`, { headers: { cookie } })).json()) as { apps: { clientId: string; name: string }[] };
    assert.equal(apps.apps[0].name, 'Test Agent');
    await fetch(`${base}/api/agent/apps/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ clientId: apps.apps[0].clientId }),
    });
    assert.equal((await rpc(t.data.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);
  });
});

describe('/mcp', () => {
  it('needs a token, and says where to get one', async () => {
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 401);
    assert.match(r.headers.get('www-authenticate')!, /resource_metadata=".*\/.well-known\/oauth-protected-resource"/);
  });

  it('expires access tokens', async () => {
    const t = await tokens(await connect(await user()));
    clock += ACCESS_MS + 1;
    assert.equal((await rpc(t.data.access_token, { jsonrpc: '2.0', id: 1, method: 'ping' })).status, 401);
  });

  it('initializes and lists the editor tools', async () => {
    const t = await tokens(await connect(await user()));
    const init = (await (await rpc(t.data.access_token, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })).json()) as {
      result: { protocolVersion: string; serverInfo: { name: string } };
    };
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.equal(init.result.serverInfo.name, 'vidora');
    assert.equal((await rpc(t.data.access_token, { jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
    const list = (await (await rpc(t.data.access_token, { jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()) as { result: { tools: { name: string }[] } };
    const names = list.result.tools.map((x) => x.name);
    assert.ok(names.includes('vidora_status') && names.includes('add_text') && names.includes('snapshot'));
  });

  it('tells the agent to ask for the tab when none is connected', async () => {
    const t = await tokens(await connect(await user()));
    const r = (await (await rpc(t.data.access_token, { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_project', arguments: {} } })).json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    assert.equal(r.result.isError, true);
    assert.match(r.result.content[0].text, /Allow agent access/);
  });

  it('relays a call to the open tab and returns its answer', async () => {
    const cookie = await user();
    const t = await tokens(await connect(cookie));
    // The tab: an event stream, answering each call.
    const stream = await fetch(`${base}/api/bridge/stream`, { headers: { cookie } });
    assert.equal(stream.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const reader = stream.body!.getReader();
    const events = (async function* () {
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        buf += Buffer.from(value).toString('utf8');
        let i: number;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const block = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const event = /^event: (.+)$/m.exec(block)?.[1];
          const data = /^data: (.+)$/m.exec(block)?.[1];
          if (event && data) yield { event, data: JSON.parse(data) };
        }
      }
    })();
    const hello = (await events.next()).value!;
    assert.equal(hello.event, 'hello');
    const answer = rpc(t.data.access_token, { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'get_project', arguments: {} } });
    const call = (await events.next()).value!;
    assert.equal(call.event, 'call');
    assert.equal(call.data.tool, 'get_project');
    const posted = await fetch(`${base}/api/bridge/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ tabId: hello.data.tabId, callId: call.data.callId, result: { content: [{ type: 'text', text: '{"name":"Demo"}' }] } }),
    });
    assert.equal(posted.status, 200);
    const r = (await (await answer).json()) as { result: { content: { text: string }[] } };
    assert.equal(r.result.content[0].text, '{"name":"Demo"}');
    // Another user cannot answer (or see) this user's calls.
    const other = await user('b@example.com');
    const stolen = await fetch(`${base}/api/bridge/result`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: other },
      body: JSON.stringify({ tabId: hello.data.tabId, callId: call.data.callId, result: { content: [] } }),
    });
    assert.equal(stolen.status, 404);
    // A tab that never answers: the agent gets an error once the bridge stops waiting.
    const late = (await (await rpc(t.data.access_token, { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'get_project', arguments: {} } })).json()) as {
      result: { isError: boolean; content: { text: string }[] };
    };
    assert.equal(late.result.isError, true);
    assert.match(late.result.content[0].text, /in time/);
    await reader.cancel();
  });
});
