// The MCP endpoint (POST /mcp, Streamable HTTP with plain JSON answers): JSON-RPC for initialize,
// tools/list and tools/call. The tools are the editor's agent commands (src/features/agent/commands.ts,
// copied into agentTools.json by its test); calls are relayed to the user's tab through the bridge.
import { readFileSync } from 'node:fs';
import { NoTabError, type Bridge } from './bridge.ts';

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

interface Tool {
  name: string;
  description: string;
  inputSchema: object;
  annotations?: object;
}

const STATUS_TOOL: Tool = {
  name: 'vidora_status',
  description: 'Whether the user has Vidora open with Agent access on (needed for every other tool), and their plan.',
  inputSchema: { type: 'object', properties: {} },
  annotations: { readOnlyHint: true },
};

const EDITOR_TOOLS = JSON.parse(readFileSync(new URL('./agentTools.json', import.meta.url), 'utf8')) as Tool[];
export const TOOLS: Tool[] = [STATUS_TOOL, ...EDITOR_TOOLS];
const TOOL_NAMES = new Set(EDITOR_TOOLS.map((t) => t.name));

const INSTRUCTIONS = `Vidora is a video editor that runs in the user's browser. These tools edit the project open in their Vidora tab, live: the user sees every change and can undo it.
- Every tool needs the user's tab open with Agent access on ("AI agent" button, top bar). If a tool says it is not connected, ask the user to do that.
- Call get_project first and again after edits: it gives the ids of tracks, clips and subtitle tracks. Times are in seconds on the timeline.
- Positions: transform x/y are offsets of the centre as fractions of the frame (0,0 = centre; y 0.35 = lower third). Text sizes are pixels at the project resolution.
- Use snapshot to look at a frame after visual changes.
- Media files are imported by the user; you can add library stickers, sounds, overlays and backgrounds.
- auto_captions, translate_captions and request_export run in the background: poll job_status. Exporting needs the user to press Export.`;

interface Rpc {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
}

export interface McpUser {
  userId: number;
  plan: 'free' | 'pro';
}

const NOT_CONNECTED =
  'Vidora is not connected. Ask the user to open the Vidora editor in their browser, log in, press "AI agent" in the top bar and choose "Allow agent access", then try again.';

const text = (t: string, isError = false) => ({ content: [{ type: 'text', text: t }], ...(isError && { isError: true }) });

/** Answer one JSON-RPC message; null for notifications (no answer). */
export async function handleRpc(msg: Rpc, user: McpUser, bridge: Bridge, version: string): Promise<object | null> {
  if (msg === null || typeof msg !== 'object' || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string')
    return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
  if (msg.id === undefined) return null; // a notification (initialized, cancelled…)
  const ok = (result: object) => ({ jsonrpc: '2.0', id: msg.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: msg.id, error: { code, message } });
  const params = msg.params ?? {};

  switch (msg.method) {
    case 'initialize': {
      const asked = String(params.protocolVersion ?? '');
      return ok({
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'vidora', title: 'Vidora video editor', version },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const name = String(params.name ?? '');
      if (name === STATUS_TOOL.name)
        return ok(text(JSON.stringify({ connected: bridge.connected(user.userId), plan: user.plan, ...(!bridge.connected(user.userId) && { help: NOT_CONNECTED }) })));
      if (!TOOL_NAMES.has(name)) return fail(-32602, `Unknown tool: ${name}`);
      try {
        return ok((await bridge.call(user.userId, name, params.arguments ?? {})) as object);
      } catch (e) {
        if (e instanceof NoTabError) return ok(text(e.message || NOT_CONNECTED, true));
        return ok(text(e instanceof Error ? e.message : String(e), true));
      }
    }
    default:
      return fail(-32601, `Method not found: ${msg.method}`);
  }
}
