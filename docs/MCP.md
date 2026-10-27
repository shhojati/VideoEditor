# Vidora for AI agents (MCP)

Any AI app that supports remote MCP servers (Claude, ChatGPT, Cursor, Claude Code…) can edit
the project a user has open in Vidora. It can add clips, text, shapes and effects, cut, animate,
insert templates and library items, make and translate captions, take snapshots, and open the
export window.

```
AI app ──HTTPS: MCP + OAuth──► https://editor.shahabdev.ir/mcp  (server/, the `api` service)
                                        │  relays by user
                                event stream down, POST up (/api/bridge/*)
                                        ▼
                            the user's open Vidora tab (src/features/agent/)
```

Everything still runs in the browser: rendering, Whisper captions and export need the user's
tab, and the VPS is too small to do any of it. The server only passes messages along.

## For users

1. In the AI app, add a custom connector / MCP server with the address
   `https://editor.shahabdev.ir/mcp`.
   - **Claude (claude.ai / desktop):** Settings → Connectors → Add custom connector.
   - **Claude Code:** `claude mcp add --transport http vidora https://editor.shahabdev.ir/mcp`
   - **Cursor:** in `mcp.json`: `{ "mcpServers": { "vidora": { "url": "https://editor.shahabdev.ir/mcp" } } }`
   - **ChatGPT:** where custom MCP connectors are enabled (developer mode), add the same address.
2. The app opens a Vidora page: log in and press **Allow**.
3. Open the editor, press **AI agent** in the top bar, then **Allow agent access**. Access lasts
   while that tab is open. It stays on through a reload of that tab, and turns off on logout.
4. Ask the AI app for edits. Each change is one normal undo step. Export still needs the user to
   press Export. The plan's rules still apply: Free exports are capped at 60 s and carry the
   watermark, and translation needs Pro.

To disconnect an app, use **AI agent → Connected apps → Disconnect**. Changing the password also
disconnects every app.

## How it works

- **Tools** (`src/features/agent/commands.ts`): each command has a zod schema and edits through
  `useProjectStore().edit`. The same list is published as the MCP tool list.
  `server/src/agentTools.json` is a copy of it, so the server can list the tools before any tab
  connects. `commands.test.ts` fails when that copy is stale. To regenerate it:
  `UPDATE_AGENT_TOOLS=1 npx vitest run src/features/agent`.
- **Relay** (`server/src/bridge.ts`, in memory):
  - A tab with access on holds `GET /api/bridge/stream` open (server-sent events, cookie auth).
  - Calls go to the user's most recently connected tab, and the tab answers with
    `POST /api/bridge/result`.
  - A call times out after 2 minutes. Long jobs (captions, translation, export) return
    immediately, and the agent polls `job_status` for progress.
- **MCP** (`server/src/mcp.ts`):
  - `POST /mcp` uses Streamable HTTP with plain JSON answers and no session id. It supports
    `initialize`, `tools/list`, `tools/call` and `ping`.
  - The server adds its own `vidora_status` tool, which tells the agent whether a tab is connected.
- **OAuth 2.1** (`server/src/oauth.ts`):
  - Discovery documents under `/.well-known/`.
  - Dynamic client registration at `/oauth/register`.
  - `/oauth/authorize` is the page where the user logs in and allows the app. It is protected
    against CSRF and cannot be framed.
  - Tokens use PKCE S256 only. Access tokens last 1 hour. Refresh tokens last 60 days and rotate
    on use. Only SHA-256 hashes are stored, in `oauth_*` tables.

## Server

- `PUBLIC_URL` (set in `deploy/docker-compose.yml`) must be the editor's https address. It is the
  OAuth issuer, and AI apps are redirected to it to log in.
- nginx (`deploy/nginx.conf`) proxies `/mcp`, `/oauth/` and `/.well-known/oauth-*` to the API.
  It does not buffer the bridge's event stream, and it allows 4 MB tool results (snapshots).
  Caddy in front passes event streams through as is.
- In development, `npm run dev` proxies the same paths, so the MCP address is
  `http://localhost:5173/mcp`.
- To check the server by hand, use the MCP Inspector (`npx @modelcontextprotocol/inspector`) with
  transport "Streamable HTTP" and the address above.
