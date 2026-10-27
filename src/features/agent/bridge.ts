// The tab's end of the agent bridge. With Agent access on, the tab listens to the MCP server
// (server/src/bridge.ts) over server-sent events, runs each tool call (commands.ts) and posts the
// result back. Off by default; remembered for this browser tab only.
import { create } from 'zustand';
import { api } from '../../lib/api';
import { useAccount } from '../../store/account';
import { runCommand } from './commands';

export interface AgentCall {
  tool: string;
  ok: boolean;
  at: number;
}

interface AgentState {
  status: 'off' | 'connecting' | 'on' | 'error';
  /** The latest calls, newest first. */
  log: AgentCall[];
}

export const useAgent = create<AgentState>()(() => ({ status: 'off', log: [] }));

const REMEMBER = 'vidora.agentAccess';
const LOG_SIZE = 20;

let source: EventSource | null = null;
let tabId = '';

function remember(on: boolean) {
  try {
    if (on) sessionStorage.setItem(REMEMBER, '1');
    else sessionStorage.removeItem(REMEMBER);
  } catch {
    // storage blocked: access just is not remembered
  }
}

async function handleCall({ callId, tool, args }: { callId: string; tool: string; args: unknown }) {
  const result = await runCommand(tool, args);
  useAgent.setState((s) => ({ log: [{ tool, ok: !result.isError, at: Date.now() }, ...s.log].slice(0, LOG_SIZE) }));
  try {
    await api('/bridge/result', { tabId, callId, result });
  } catch (e) {
    console.warn('agent result not delivered', e);
  }
}

export function startAgent() {
  if (source || !useAccount.getState().me) return;
  remember(true);
  useAgent.setState({ status: 'connecting' });
  const es = new EventSource('/api/bridge/stream');
  source = es;
  es.addEventListener('hello', (e) => {
    tabId = (JSON.parse(e.data) as { tabId: string }).tabId;
    useAgent.setState({ status: 'on' });
  });
  es.addEventListener('call', (e) => void handleCall(JSON.parse(e.data)));
  es.onerror = () => {
    if (source !== es) return;
    // CLOSED: refused (logged out); otherwise the browser reconnects by itself.
    if (es.readyState === EventSource.CLOSED) {
      source = null;
      useAgent.setState({ status: 'error' });
    } else useAgent.setState({ status: 'connecting' });
  };
}

export function stopAgent() {
  source?.close();
  source = null;
  tabId = '';
  remember(false);
  useAgent.setState({ status: 'off' });
}

/** Turn access back on after a reload of this tab, and off when the user logs out. */
export function initAgent() {
  let wasIn = false;
  const sync = () => {
    const me = useAccount.getState().me;
    let remembered = false;
    try {
      remembered = sessionStorage.getItem(REMEMBER) === '1';
    } catch {
      // storage blocked
    }
    if (me && !wasIn && remembered) startAgent();
    if (!me && wasIn) stopAgent();
    wasIn = !!me;
  };
  sync();
  return useAccount.subscribe(sync);
}

// ---- apps the user connected with OAuth (server/src/oauth.ts) ----

export interface ConnectedApp {
  clientId: string;
  name: string;
  connectedAt: number;
  lastUsedAt: number | null;
}

export const listConnectedApps = () => api<{ apps: ConnectedApp[] }>('/agent/apps').then((r) => r.apps);
export const disconnectApp = (clientId: string) => api('/agent/apps/revoke', { clientId });
