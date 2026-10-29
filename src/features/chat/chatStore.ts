// The AI chat's state: the conversation for the open project (kept in memory only), which tool
// calls ran, and whether a request is under way.
import { create } from 'zustand';
import { ApiError } from '../../lib/api';
import { refreshAccount, setCredits, useAccount } from '../../store/account';
import { useProjectStore } from '../../store/projectStore';
import { runCommand } from '../agent/commands';
import { runChat, type ChatMessage, type TurnReply } from './chatLoop';

export type CallState = 'running' | 'ok' | 'error';

interface ChatState {
  projectId: string | null;
  messages: ChatMessage[];
  calls: Record<string, CallState>;
  busy: boolean;
  /** An account.errors / chat.errors code from the last request. */
  error: string | null;
}

export const useChat = create<ChatState>()(() => ({ projectId: null, messages: [], calls: {}, busy: false, error: null }));

let controller: AbortController | null = null;

const projectId = () => useProjectStore.getState().history?.present.id ?? null;

/** A different project was opened: its own, empty conversation. */
function syncProject() {
  const id = projectId();
  if (id === useChat.getState().projectId) return;
  controller?.abort();
  useChat.setState({ projectId: id, messages: [], calls: {}, busy: false, error: null });
}
useProjectStore.subscribe(syncProject);

const send = (messages: ChatMessage[], signal: AbortSignal) =>
  // Through fetch so Stop can cancel the request; same errors as api().
  fetch('/api/chat/turn', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
    signal,
  }).then(
    async (r) => {
      const data = (await r.json().catch(() => null)) as (TurnReply & { error?: string }) | null;
      if (!r.ok || !data) throw new ApiError(r.status, data?.error ?? 'network');
      return data;
    },
    (e: unknown) => {
      throw signal.aborted ? e : new ApiError(0, 'network');
    },
  );

export async function sendChat(text: string) {
  syncProject();
  const s = useChat.getState();
  if (s.busy || !text.trim() || !useAccount.getState().me) return;
  const ctl = new AbortController();
  controller = ctl;
  const id = s.projectId;
  // Stop does not end the loop at once: it still answers the open tool calls, so keep its updates.
  const current = () => useChat.getState().projectId === id;
  useChat.setState({ messages: [...s.messages, { role: 'user', content: text.trim() }], busy: true, error: null });
  try {
    await runChat(useChat.getState().messages, {
      signal: ctl.signal,
      send,
      run: runCommand,
      onUpdate: (messages, status, credits) => {
        if (!current()) return;
        const calls = { ...useChat.getState().calls };
        const last = messages.at(-1);
        if (last?.role === 'assistant') for (const c of last.tool_calls ?? []) calls[c.id] = 'running';
        if (status) calls[status.callId] = status.ok ? 'ok' : 'error';
        if (status && !status.ok) {
          const call = messages.flatMap((m) => (m.role === 'assistant' ? (m.tool_calls ?? []) : [])).find((c) => c.id === status.callId);
          const result = messages.find((m) => m.role === 'tool' && m.tool_call_id === status.callId);
          console.warn('AI chat: tool failed', call?.function.name, call?.function.arguments, result?.content);
        }
        useChat.setState({ messages, calls });
        if (credits !== undefined) setCredits(credits);
      },
    });
  } catch (e) {
    if (!current() || ctl.signal.aborted) return;
    const code = e instanceof ApiError ? e.code : 'network';
    useChat.setState({ error: code });
    if (code === 'no_credits') refreshAccount(true);
  } finally {
    if (controller === ctl) controller = null;
    if (current()) useChat.setState({ busy: false });
  }
}

/** The request in flight is cancelled; tool calls not yet run are skipped. */
export const stopChat = () => controller?.abort();

export function clearChat() {
  if (useChat.getState().busy) return;
  useChat.setState({ messages: [], calls: {}, error: null });
}
