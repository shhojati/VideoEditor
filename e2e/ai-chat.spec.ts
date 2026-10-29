import { expect, test, type Page } from '@playwright/test';

/** Clips of the open project (dev-only store handle). */
const clips = (page: Page) =>
  page.evaluate(() => {
    type P = { tracks: { clips: { id: string; text?: { content: string } }[] }[] };
    const w = window as unknown as { __stores: { project: { getState: () => { history: { present: P } | null } } } };
    return (w.__stores.project.getState().history?.present.tracks ?? []).flatMap((t) => t.clips);
  });

test('the AI chat edits the project with the tab’s tools and shows the credits left', async ({ page }) => {
  // The test API has no AI key: say the chat is on, and play the model.
  await page.route('**/api/me', async (route) => {
    const r = await route.fetch();
    const body = await r.json();
    await route.fulfill({ response: r, json: { ...body, chat: true, user: body.user && { ...body.user, credits: 100 } } });
  });
  const requests: { messages: { role: string; content?: unknown }[] }[] = [];
  await page.route('**/api/chat/turn', async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (requests.length === 1)
      return route.fulfill({
        json: {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'add_text', arguments: JSON.stringify({ content: 'Hello from chat', start: 0, duration: 2 }) } }],
          },
          charged: 3,
          credits: 97,
        },
      });
    return route.fulfill({ json: { message: { role: 'assistant', content: 'Added the title.' }, charged: 2, credits: 95 } });
  });

  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await expect(page.getByTestId('btn-add-text')).toBeVisible();

  await page.getByTestId('right-ai').click();
  await expect(page.getByTestId('chat-credits')).toHaveText('100 credits');
  await page.getByTestId('chat-input').fill('Add a title');
  await page.getByTestId('chat-input').press('Enter');

  await expect(page.getByTestId('chat-assistant')).toHaveText('Added the title.');
  await expect(page.getByTestId('chat-call')).toHaveAttribute('data-state', 'ok');
  await expect(page.getByTestId('chat-credits')).toHaveText('95 credits');
  expect(await clips(page)).toContainEqual(expect.objectContaining({ text: expect.objectContaining({ content: 'Hello from chat' }) }));

  // The tool result went back to the model in the second request.
  expect(requests[1].messages.map((m) => m.role)).toEqual(['user', 'assistant', 'tool']);

  // One undo removes the AI's edit.
  await page.getByTestId('right-inspector').click();
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await clips(page)).some((c) => c.text?.content === 'Hello from chat')).toBe(false);
});

test('out of credits: the chat says so and offers to buy', async ({ page }) => {
  await page.route('**/api/me', async (route) => {
    const r = await route.fetch();
    const body = await r.json();
    await route.fulfill({ response: r, json: { ...body, chat: true, user: body.user && { ...body.user, credits: 0 } } });
  });
  await page.route('**/api/chat/turn', (route) => route.fulfill({ status: 402, json: { error: 'no_credits' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'English' }).click();
  await page.getByTestId('right-ai').click();
  await page.getByTestId('chat-input').fill('hi');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-error')).toContainText('out of AI credits');
  await page.getByTestId('chat-error').getByRole('button', { name: 'Buy credits' }).click();
  await expect(page.getByTestId('account-credits')).toBeVisible();
});
