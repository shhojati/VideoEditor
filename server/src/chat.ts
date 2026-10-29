// The editor's built-in AI chat. The tab sends the conversation, this asks the model (OpenRouter,
// the owner's key) for the next step and charges the user's credits for what it actually cost. Tool
// calls come back to the tab, which runs them itself (src/features/agent/commands.ts) and sends the
// results in the next turn: nothing of the project is stored here.
import { readFileSync, writeFileSync } from 'node:fs';
import type { Db } from './db.ts';
import { INSTRUCTIONS } from './mcp.ts';

export interface AiConfig {
  /** OpenRouter key; chat is off without it. */
  apiKey: string;
  model: string;
  baseUrl: string;
  /** What the user pays over the provider's price (1.5 = +50 %). */
  markup: number;
  /** Credits charged per US dollar of (marked-up) cost. */
  creditsPerUsd: number;
  /** A turn needs at least this many credits to start. */
  minCredits: number;
  maxTokens: number;
  /** Price per million tokens when the provider does not report a cost. */
  fallbackUsdPerMTok: number;
  timeoutMs: number;
}

/** Env: OPENROUTER_API_KEY, AI_MODEL, AI_BASE_URL, AI_MARKUP, AI_CREDITS_PER_USD, AI_MIN_CREDITS, AI_MAX_TOKENS. */
export function aiConfigFromEnv(env: NodeJS.ProcessEnv): AiConfig {
  const num = (name: string, def: number) => {
    const v = Number(env[name]);
    return env[name] && Number.isFinite(v) && v > 0 ? v : def;
  };
  return {
    apiKey: env.OPENROUTER_API_KEY ?? '',
    model: env.AI_MODEL || 'openai/gpt-4.1-mini',
    baseUrl: (env.AI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, ''),
    markup: num('AI_MARKUP', 1.5),
    creditsPerUsd: num('AI_CREDITS_PER_USD', 1000),
    minCredits: num('AI_MIN_CREDITS', 5),
    maxTokens: num('AI_MAX_TOKENS', 2048),
    fallbackUsdPerMTok: num('AI_FALLBACK_USD_PER_MTOK', 5),
    timeoutMs: num('AI_TIMEOUT_MS', 120_000),
  };
}

interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const EDITOR_TOOLS = JSON.parse(readFileSync(new URL('./agentTools.json', import.meta.url), 'utf8')) as Tool[];

/** The editor commands as OpenAI-style function tools. */
export const CHAT_TOOLS = EDITOR_TOOLS.map((t) => {
  const { $schema: _, ...parameters } = t.inputSchema;
  return { type: 'function', function: { name: t.name, description: t.description, parameters } };
});

const SYSTEM = `You are the assistant built into Vidora, a video editor. You edit the user's open project with the tools; they see every change live and can undo it.
Answer in the user's language, briefly. Do what they ask, then say in a sentence what you changed. Ask only when the request is really unclear.
${INSTRUCTIONS.split('\n').filter((l) => !l.includes('Agent access')).join('\n')}`;

export const MAX_MESSAGES = 200;
const MAX_IMAGES = 4;

export class ChatError extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
type Message =
  | { role: 'user'; content: string | Part[] }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

const isStr = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;

/** Only the shapes the tab sends; anything else (a system message, other fields) is refused. */
export function checkMessages(raw: unknown): Message[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > MAX_MESSAGES) throw new ChatError(400, 'bad_request');
  let images = 0;
  const out = raw.map((m): Message => {
    if (!m || typeof m !== 'object') throw new ChatError(400, 'bad_request');
    const r = m as Record<string, unknown>;
    if (r.role === 'user') {
      if (isStr(r.content, 20_000)) return { role: 'user', content: r.content };
      if (!Array.isArray(r.content) || !r.content.length || r.content.length > 8) throw new ChatError(400, 'bad_request');
      return {
        role: 'user',
        content: r.content.map((p): Part => {
          const q = (p ?? {}) as Record<string, unknown>;
          if (q.type === 'text' && isStr(q.text, 20_000)) return { type: 'text', text: q.text };
          const url = (q.image_url as { url?: unknown } | undefined)?.url;
          if (q.type === 'image_url' && isStr(url, 3_000_000) && /^data:image\/(png|jpeg|webp);base64,/.test(url)) {
            images++;
            return { type: 'image_url', image_url: { url } };
          }
          throw new ChatError(400, 'bad_request');
        }),
      };
    }
    if (r.role === 'assistant') {
      const content = r.content == null ? null : isStr(r.content, 20_000) ? r.content : undefined;
      if (content === undefined) throw new ChatError(400, 'bad_request');
      if (r.tool_calls === undefined) return { role: 'assistant', content };
      if (!Array.isArray(r.tool_calls) || r.tool_calls.length > 32) throw new ChatError(400, 'bad_request');
      const calls = r.tool_calls.map((c): ToolCall => {
        const f = ((c ?? {}) as { function?: Record<string, unknown> }).function ?? {};
        const id = (c as { id?: unknown }).id;
        if (!isStr(id, 200) || !isStr(f.name, 100) || !isStr(f.arguments, 100_000)) throw new ChatError(400, 'bad_request');
        return { id, type: 'function', function: { name: f.name, arguments: f.arguments } };
      });
      return { role: 'assistant', content, tool_calls: calls };
    }
    if (r.role === 'tool' && isStr(r.tool_call_id, 200) && isStr(r.content, 200_000))
      return { role: 'tool', tool_call_id: r.tool_call_id, content: r.content };
    throw new ChatError(400, 'bad_request');
  });
  if (images > MAX_IMAGES) throw new ChatError(400, 'bad_request');
  return out;
}

interface Completion {
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

export const creditsOf = (db: Db, userId: number) =>
  ((db.prepare('SELECT credits FROM users WHERE id = ?').get(userId) as { credits: number } | undefined)?.credits ?? 0);

/** Add (or with a negative delta, take) credits and log why, in one transaction. Returns the new balance. */
export function addCredits(
  db: Db,
  now: number,
  e: { userId: number; delta: number; reason: 'grant' | 'chat' | 'refund'; adminId?: number; amountToman?: number; note?: string },
): number {
  db.exec('BEGIN');
  try {
    db.prepare('UPDATE users SET credits = credits + ? WHERE id = ?').run(e.delta, e.userId);
    db.prepare(
      'INSERT INTO credit_ledger (user_id, admin_id, delta, reason, amount_toman, note, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(e.userId, e.adminId ?? null, e.delta, e.reason, e.amountToman ?? 0, e.note ?? '', now);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return creditsOf(db, e.userId);
}

/**
 * Tool calls that failed in the tab since the model's last reply (the tab marks their results
 * "Error: …"), as `name(arguments) → error` lines for the log. Earlier ones were logged before.
 */
export function failedCalls(messages: Message[]): string[] {
  let i = messages.length;
  while (i > 0 && messages[i - 1].role !== 'assistant') i--;
  const reply = messages[i - 1];
  if (!reply || reply.role !== 'assistant') return [];
  const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s).replace(/\s+/g, ' ');
  return messages.slice(i).flatMap((m) => {
    if (m.role !== 'tool' || !m.content.startsWith('Error: ')) return [];
    const call = reply.tool_calls?.find((c) => c.id === m.tool_call_id);
    return [`${call?.function.name ?? '?'}(${cut(call?.function.arguments ?? '', 400)}) → ${cut(m.content.slice(7), 400)}`];
  });
}

/** One line about a conversation for the log: how long, what is in it, how it ends. */
export function describeMessages(messages: Message[], bytes: number): string {
  const images = messages.reduce(
    (n, m) => n + (m.role === 'user' && typeof m.content !== 'string' ? m.content.filter((p) => p.type === 'image_url').length : 0),
    0,
  );
  const tools = messages.flatMap((m) => (m.role === 'assistant' ? (m.tool_calls ?? []).map((c) => c.function.name) : []));
  const last = messages.at(-1)!;
  const end = last.role === 'tool' ? `tool result (${last.content.length} chars)` : last.role === 'user' && typeof last.content !== 'string' ? 'picture' : last.role;
  return `${messages.length} messages, ${Math.round(bytes / 1024)} KB, ${images} picture(s), tools so far: ${tools.join(' ') || 'none'}; ends with ${end}`;
}

export function createChat(opts: {
  db: Db;
  config: AiConfig;
  now: () => number;
  fetch?: typeof fetch;
  /** Where the last request the provider refused is saved, to see what it objected to. */
  failedRequestFile?: string;
}) {
  const { db, config } = opts;
  const fetchImpl = opts.fetch ?? fetch;

  /** Credits for a completion: the reported cost (or a token estimate), marked up, rounded up, at least 1. */
  function price(usage: Completion['usage']): number {
    const tokens = (usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0);
    const usd = typeof usage?.cost === 'number' && usage.cost >= 0 ? usage.cost : (tokens * config.fallbackUsdPerMTok) / 1e6;
    return Math.max(1, Math.ceil(usd * config.markup * config.creditsPerUsd));
  }

  return {
    get enabled() {
      return !!config.apiKey;
    },

    async turn(userId: number, rawMessages: unknown) {
      if (!config.apiKey) throw new ChatError(503, 'ai_disabled');
      const messages = checkMessages(rawMessages);
      for (const line of failedCalls(messages)) console.warn(`chat: u${userId} tool failed ${line}`);
      if (creditsOf(db, userId) < config.minCredits) throw new ChatError(402, 'no_credits');
      const body = JSON.stringify({
        model: config.model,
        messages: [{ role: 'system', content: SYSTEM }, ...messages],
        tools: CHAT_TOOLS,
        max_tokens: config.maxTokens,
        usage: { include: true },
        user: `u${userId}`,
      });
      let r: Response;
      try {
        r = await fetchImpl(`${config.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
            'X-Title': 'Vidora',
          },
          body,
          signal: AbortSignal.timeout(config.timeoutMs),
        });
      } catch (e) {
        console.error('chat: provider unreachable', e);
        throw new ChatError(502, 'ai_unavailable');
      }
      const data = (await r.json().catch(() => null)) as Completion | null;
      const msg = data?.choices?.[0]?.message;
      if (!r.ok || !msg) {
        console.error('chat: provider error', r.status, JSON.stringify(data).slice(0, 500), '|', describeMessages(messages, body.length));
        if (opts.failedRequestFile)
          try {
            writeFileSync(opts.failedRequestFile, body);
            console.error('chat: refused request saved to', opts.failedRequestFile);
          } catch (e) {
            console.error('chat: could not save the refused request', e);
          }
        throw new ChatError(502, 'ai_unavailable');
      }
      const charged = price(data.usage);
      const credits = addCredits(db, opts.now(), { userId, delta: -charged, reason: 'chat', note: config.model });
      const calls = (msg.tool_calls ?? []).filter((c) => c?.function?.name);
      return {
        message: {
          role: 'assistant' as const,
          content: msg.content ?? null,
          ...(calls.length && {
            tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.function.name, arguments: c.function.arguments || '{}' } })),
          }),
        },
        charged,
        credits,
      };
    },
  };
}
