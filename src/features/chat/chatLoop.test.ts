import { describe, expect, it, vi } from 'vitest';
import { limitImages, MAX_TOOL_TEXT, PICTURE_NOTE, resultMessages, runChat, type ChatMessage, type TurnReply } from './chatLoop';

const say = (content: string): TurnReply => ({ message: { role: 'assistant', content }, charged: 1, credits: 10 });
const callTool = (id: string, name: string, args: string): TurnReply => ({
  message: { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name, arguments: args } }] },
  charged: 2,
  credits: 8,
});

describe('runChat', () => {
  it('runs tool calls in the tab and sends the results back until the model answers', async () => {
    const replies = [callTool('c1', 'add_text', '{"text":"Hi"}'), say('Added a title.')];
    const send = vi.fn(async () => replies.shift()!);
    const run = vi.fn(async () => ({ content: [{ type: 'text' as const, text: '{"clipId":"x"}' }] }));
    const onUpdate = vi.fn();
    const out = await runChat([{ role: 'user', content: 'title please' }], { send, run, onUpdate, signal: new AbortController().signal });
    expect(run).toHaveBeenCalledWith('add_text', { text: 'Hi' });
    expect(send).toHaveBeenCalledTimes(2);
    expect(out.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'assistant']);
    expect(out[2]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '{"clipId":"x"}' });
    expect(onUpdate).toHaveBeenCalledWith(expect.anything(), { callId: 'c1', ok: true });
    expect(onUpdate).toHaveBeenLastCalledWith(out, null, 10);
  });

  it('stops after maxSteps', async () => {
    const send = vi.fn(async () => callTool('c', 'get_project', '{}'));
    const run = vi.fn(async () => ({ content: [{ type: 'text' as const, text: '{}' }] }));
    await runChat([{ role: 'user', content: 'loop' }], { send, run, onUpdate: () => {}, signal: new AbortController().signal, maxSteps: 3 });
    expect(send).toHaveBeenCalledTimes(3);
  });

  it('answers open calls without running them once stopped', async () => {
    const ctl = new AbortController();
    const send = vi.fn(async () => (ctl.abort(), callTool('c1', 'delete_clips', '{}')));
    const run = vi.fn();
    const out = await runChat([{ role: 'user', content: 'x' }], { send, run, onUpdate: () => {}, signal: ctl.signal });
    expect(run).not.toHaveBeenCalled();
    expect(out.at(-1)).toMatchObject({ role: 'tool', tool_call_id: 'c1', content: expect.stringContaining('Stopped') });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('reports bad JSON arguments as an error result', async () => {
    const replies = [callTool('c1', 'add_text', '{oops'), say('Sorry.')];
    const run = vi.fn();
    const out = await runChat([{ role: 'user', content: 'x' }], { send: async () => replies.shift()!, run, onUpdate: () => {}, signal: new AbortController().signal });
    expect(run).not.toHaveBeenCalled();
    expect(out[2]).toMatchObject({ role: 'tool', content: expect.stringMatching(/^Error: .*JSON/) });
  });
});

describe('resultMessages', () => {
  it('sends a snapshot as a picture after the tool answer', () => {
    const out = resultMessages('c1', { content: [{ type: 'image', data: 'AAAA', mimeType: 'image/jpeg' }] });
    expect(out).toEqual([
      { role: 'tool', tool_call_id: 'c1', content: PICTURE_NOTE },
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }] },
    ]);
  });

  it('cuts very long output', () => {
    const [m] = resultMessages('c1', { content: [{ type: 'text', text: 'x'.repeat(MAX_TOOL_TEXT + 10) }] });
    expect((m as { content: string }).content).toMatch(/\[cut: 10 more characters\]$/);
  });
});

describe('limitImages', () => {
  it('keeps the newest pictures and replaces older ones with a note', () => {
    const pic = (n: number): ChatMessage => ({ role: 'user', content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${n}` } }] });
    const out = limitImages([pic(1), pic(2), pic(3)], 2);
    expect(out[0]).toEqual({ role: 'user', content: [{ type: 'text', text: expect.stringContaining('earlier picture') }] });
    expect(out.slice(1)).toEqual([pic(2), pic(3)]);
  });
});
