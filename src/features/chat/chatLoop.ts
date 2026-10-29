// One chat request from the user, to the end: ask the server (server/src/chat.ts) for the model's
// next step, run the tool calls it makes here in the tab (agent/commands.ts), send back the results,
// and repeat until the model answers in words.
import type { ToolResult } from '../agent/commands';

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
/** The conversation as the model sees it (OpenAI chat format). */
export type ChatMessage =
  | { role: 'user'; content: string | ContentPart[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

export interface TurnReply {
  message: Extract<ChatMessage, { role: 'assistant' }>;
  charged: number;
  credits: number;
}

export interface LoopDeps {
  send: (messages: ChatMessage[], signal: AbortSignal) => Promise<TurnReply>;
  run: (tool: string, args: unknown) => Promise<ToolResult>;
  /** After every change to the conversation (a reply, a tool result). */
  onUpdate: (messages: ChatMessage[], status: { callId: string; ok: boolean } | null, credits?: number) => void;
  signal: AbortSignal;
  maxSteps?: number;
}

/** Tool output the model gets back, at most (get_project of a big project can be long). */
export const MAX_TOOL_TEXT = 60_000;
/** Pictures sent per request; the server refuses more. */
const MAX_IMAGES = 4;
export const PICTURE_NOTE = 'The picture is in the next message.';
const DROPPED_PICTURE = '[An earlier picture, no longer attached.]';

/** A tool result as messages: its text for the call, and pictures (snapshot) as a user message after it. */
export function resultMessages(callId: string, result: ToolResult): ChatMessage[] {
  const text = result.content.flatMap((c) => (c.type === 'text' ? [c.text] : [])).join('\n');
  const images = result.content.flatMap((c) => (c.type === 'image' ? [`data:${c.mimeType};base64,${c.data}`] : []));
  let body = (result.isError ? 'Error: ' : '') + (text || (images.length ? PICTURE_NOTE : 'ok'));
  if (body.length > MAX_TOOL_TEXT) body = `${body.slice(0, MAX_TOOL_TEXT)}\n[cut: ${body.length - MAX_TOOL_TEXT} more characters]`;
  const out: ChatMessage[] = [{ role: 'tool', tool_call_id: callId, content: body }];
  if (images.length) out.push({ role: 'user', content: images.map((url) => ({ type: 'image_url', image_url: { url } })) });
  return out;
}

/** Keep only the newest pictures (each one is paid for again in every request). */
export function limitImages(messages: ChatMessage[], max = MAX_IMAGES): ChatMessage[] {
  let kept = 0;
  return messages
    .slice()
    .reverse()
    .map((m) => {
      if (m.role !== 'user' || typeof m.content === 'string') return m;
      const content = m.content.map((p) => {
        if (p.type !== 'image_url') return p;
        if (kept < max) return kept++, p;
        return { type: 'text' as const, text: DROPPED_PICTURE };
      });
      return { ...m, content };
    })
    .reverse();
}

function parseArgs(raw: string): unknown {
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return undefined;
  }
}

/**
 * Runs until the model stops calling tools, `maxSteps` requests were made, or `signal` aborts.
 * Returns the conversation with everything added. Errors from `send` are thrown after the
 * conversation so far was reported through onUpdate.
 */
export async function runChat(history: ChatMessage[], deps: LoopDeps): Promise<ChatMessage[]> {
  const maxSteps = deps.maxSteps ?? 12;
  let messages = history;
  for (let step = 0; step < maxSteps; step++) {
    const reply = await deps.send(limitImages(messages), deps.signal);
    messages = [...messages, reply.message];
    deps.onUpdate(messages, null, reply.credits);
    const calls = reply.message.tool_calls ?? [];
    if (!calls.length) return messages;
    for (const call of calls) {
      // Every call gets an answer, even after Stop: the model refuses a conversation with a call left open.
      const args = parseArgs(call.function.arguments);
      const result: ToolResult = deps.signal.aborted
        ? { isError: true, content: [{ type: 'text', text: 'Stopped by the user.' }] }
        : args === undefined
          ? { isError: true, content: [{ type: 'text', text: 'The arguments were not valid JSON.' }] }
          : await deps.run(call.function.name, args);
      messages = [...messages, ...resultMessages(call.id, result)];
      deps.onUpdate(messages, { callId: call.id, ok: !result.isError });
    }
    if (deps.signal.aborted) return messages;
  }
  return messages;
}
