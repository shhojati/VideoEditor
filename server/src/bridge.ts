// Relays MCP tool calls to the user's open editor tab: everything the tools do (editing, rendering,
// captions) runs in the browser, so the server only passes messages. A tab with Agent access on
// holds a server-sent events stream open (GET /api/bridge/stream); calls go down it and results come
// back as POST /api/bridge/result. Kept in memory: one API process, a restart just reconnects tabs.
import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';

interface Tab {
  id: string;
  userId: number;
  res: ServerResponse;
}

interface Pending {
  userId: number;
  tabId: string;
  resolve: (result: unknown) => void;
  reject: (e: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/** No tab of this user has Agent access on. */
export class NoTabError extends Error {}

const HEARTBEAT_MS = 25_000;
const MAX_TABS = 5;

export class Bridge {
  /** Per user, oldest first: calls go to the tab that turned access on last. */
  private readonly tabs = new Map<number, Tab[]>();
  private readonly pending = new Map<string, Pending>();
  private readonly timeoutMs: number;

  constructor(timeoutMs = 120_000) {
    this.timeoutMs = timeoutMs;
  }

  /** Take over `res` as the event stream of a new tab. */
  open(userId: number, res: ServerResponse) {
    const tab: Tab = { id: randomUUID(), userId, res };
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      // nginx: pass events through as they are written.
      'X-Accel-Buffering': 'no',
    });
    send(res, 'hello', { tabId: tab.id });
    const list = this.tabs.get(userId) ?? [];
    list.push(tab);
    while (list.length > MAX_TABS) list.shift()!.res.end();
    this.tabs.set(userId, list);
    const beat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
    res.on('close', () => {
      clearInterval(beat);
      const rest = (this.tabs.get(userId) ?? []).filter((t) => t !== tab);
      if (rest.length) this.tabs.set(userId, rest);
      else this.tabs.delete(userId);
      for (const [id, p] of this.pending)
        if (p.tabId === tab.id) {
          this.pending.delete(id);
          clearTimeout(p.timer);
          p.reject(new NoTabError('The Vidora tab was closed.'));
        }
    });
  }

  connected(userId: number) {
    return (this.tabs.get(userId)?.length ?? 0) > 0;
  }

  /** Run a tool in the user's tab and wait for its result. */
  call(userId: number, tool: string, args: unknown): Promise<unknown> {
    const tab = this.tabs.get(userId)?.at(-1);
    if (!tab) return Promise.reject(new NoTabError());
    const callId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(callId);
        reject(new Error(`The Vidora tab did not answer ${tool} in time.`));
      }, this.timeoutMs);
      this.pending.set(callId, { userId, tabId: tab.id, resolve, reject, timer });
      send(tab.res, 'call', { callId, tool, args });
    });
  }

  /** A tab's answer; false when there is no such call for this user and tab (late, or not theirs). */
  result(userId: number, tabId: string, callId: string, result: unknown): boolean {
    const p = this.pending.get(callId);
    if (!p || p.userId !== userId || p.tabId !== tabId) return false;
    this.pending.delete(callId);
    clearTimeout(p.timer);
    p.resolve(result);
    return true;
  }

  /** Close every stream (server shutdown, tests). */
  close() {
    for (const list of this.tabs.values()) for (const t of list) t.res.end();
  }
}

function send(res: ServerResponse, event: string, data: unknown) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
