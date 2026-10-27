import { createHash, randomBytes } from 'node:crypto';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const REDIRECT = 'http://localhost:9/callback';

/** Clips of the open project (dev-only store handle). */
const clips = (page: Page) =>
  page.evaluate(() => {
    type P = { tracks: { clips: { id: string; text?: { content: string } }[] }[] };
    const w = window as unknown as { __stores: { project: { getState: () => { history: { present: P } | null } } } };
    return (w.__stores.project.getState().history?.present.tracks ?? []).flatMap((t) => t.clips);
  });

/** What an AI app does to connect: register, have the (logged-in) user allow it, get a token. */
async function connect(api: APIRequestContext) {
  const reg = await api.post('/oauth/register', { data: { client_name: 'E2E agent', redirect_uris: [REDIRECT] } });
  expect(reg.status()).toBe(201);
  const { client_id } = await reg.json();
  const verifier = randomBytes(32).toString('base64url');
  const q = {
    response_type: 'code',
    client_id,
    redirect_uri: REDIRECT,
    code_challenge: createHash('sha256').update(verifier).digest('base64url'),
    code_challenge_method: 'S256',
    state: 's1',
  };
  const html = await (await api.get(`/oauth/authorize?${new URLSearchParams(q)}`)).text();
  expect(html).toContain('E2E agent');
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1];
  const allow = await api.post('/oauth/authorize', { form: { ...q, csrf, action: 'allow' }, maxRedirects: 0 });
  expect(allow.status()).toBe(302);
  const code = new URL(allow.headers().location).searchParams.get('code')!;
  const tok = await api.post('/oauth/token', { form: { grant_type: 'authorization_code', client_id, code, code_verifier: verifier, redirect_uri: REDIRECT } });
  expect(tok.ok()).toBe(true);
  return (await tok.json()).access_token as string;
}

test('an AI agent edits the open project over MCP', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByTestId('btn-add-text')).toBeVisible();

  // The user turns on Agent access in this tab.
  await page.getByTestId('agent-button').click();
  await expect(page.getByTestId('agent-url')).toHaveText(/\/mcp$/);
  await page.getByTestId('agent-start').click();
  await expect(page.getByTestId('agent-button')).toHaveAttribute('data-status', 'on');

  const token = await connect(page.request);
  let id = 0;
  const call = async (name: string, args: object = {}) => {
    const r = await page.request.post('/mcp', {
      headers: { authorization: `Bearer ${token}` },
      data: { jsonrpc: '2.0', id: ++id, method: 'tools/call', params: { name, arguments: args } },
    });
    expect(r.ok()).toBe(true);
    return (await r.json()).result as { isError?: boolean; content: { type: string; text?: string; data?: string; mimeType?: string }[] };
  };

  const status = await call('vidora_status');
  expect(JSON.parse(status.content[0].text!)).toMatchObject({ connected: true, plan: 'pro' });

  // An edit lands on the timeline as one undo step.
  const added = await call('add_text', { content: 'Hello from the agent', start: 0, duration: 2 });
  expect(added.isError).toBeFalsy();
  const clipId = JSON.parse(added.content[0].text!).id;
  await expect.poll(async () => (await clips(page)).find((c) => c.id === clipId)?.text?.content).toBe('Hello from the agent');
  await expect(page.getByTestId('agent-log')).toContainText('add_text');

  // The agent can look at the result.
  const shot = await call('snapshot', { time: 1, maxSize: 320 });
  expect(shot.content[0]).toMatchObject({ type: 'image', mimeType: 'image/jpeg' });
  expect(Buffer.from(shot.content[0].data!, 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

  // Undo takes the agent's edit back.
  await call('undo');
  await expect.poll(async () => (await clips(page)).some((c) => c.id === clipId)).toBe(false);

  // Off again: the agent is told to ask for access.
  await page.getByTestId('agent-stop').click();
  await expect.poll(async () => (await call('get_project')).content[0].text).toContain('Allow agent access');
});
