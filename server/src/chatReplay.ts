// Finds what the AI provider refused in a saved chat request (chat.ts saves the last one to
// data/chat-refused.json). Sends it again, then smaller versions of it, and names the first message
// that gets it refused. Every request asks for one token, so this costs very little.
//   docker compose exec api node src/chatReplay.ts /data/chat-refused.json
import { readFileSync } from 'node:fs';

interface Body {
  model: string;
  messages: { role: string; content: unknown; tool_calls?: unknown[] }[];
  tools?: unknown[];
  [k: string]: unknown;
}

const file = process.argv[2] ?? '/data/chat-refused.json';
const key = process.env.OPENROUTER_API_KEY;
const base = (process.env.AI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
if (!key) throw new Error('OPENROUTER_API_KEY is not set');
const saved = JSON.parse(readFileSync(file, 'utf8')) as Body;

async function send(label: string, body: Body): Promise<number> {
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'X-Title': 'Vidora' },
    body: JSON.stringify({ ...body, max_tokens: 1 }),
  });
  const text = (await r.text()).replace(/\s+/g, ' ');
  console.log(`${label.padEnd(34)} ${r.status} ${r.ok ? '' : text.slice(0, 120)}`);
  return r.status;
}

const preview = (content: unknown) =>
  (typeof content === 'string' ? content : JSON.stringify(content)).replace(/data:image\/[a-z]+;base64,[A-Za-z0-9+/=]+/g, '[picture]').slice(0, 600);

/** Pictures replaced by a note. */
const noPictures = (b: Body): Body => ({
  ...b,
  messages: b.messages.map((m) =>
    Array.isArray(m.content)
      ? { ...m, content: (m.content as { type: string }[]).map((p) => (p.type === 'image_url' ? { type: 'text', text: '[picture]' } : p)) }
      : m,
  ),
});

/** The first `n` messages after the system prompt, cut so no tool call is left unanswered. */
function prefix(b: Body, n: number): Body {
  const [system, ...rest] = b.messages;
  let msgs = rest.slice(0, n);
  while (msgs.length && (msgs.at(-1)!.tool_calls?.length || (msgs.at(-1)!.role === 'tool' && rest[msgs.length]?.role === 'tool'))) msgs = msgs.slice(0, -1);
  return { ...b, messages: [system, ...msgs] };
}

console.log(`${file}: ${saved.messages.length} messages, model ${saved.model}\n`);
if ((await send('as saved', saved)) !== 403) {
  console.log('\nNot refused now: the refusal was temporary (rate or abuse limits), not the content.');
  process.exit(0);
}
const pics = await send('without pictures', noPictures(saved));
await send('without tools', { ...saved, tools: undefined });

// Grow the conversation until it is refused. Tool results of one reply go in together.
const n = saved.messages.length - 1;
let lastGood = 0;
for (let i = 1; i <= n; i++) {
  const b = prefix(saved, i);
  if (b.messages.length !== i + 1) continue; // ends inside a tool call: not a valid conversation
  if ((await send(`first ${i} message(s)`, b)) !== 403) {
    lastGood = i;
    continue;
  }
  console.log(`\nRefused once these messages are added:`);
  for (let j = lastGood + 1; j <= i; j++) {
    const m = saved.messages[j];
    const calls = (m.tool_calls as { function: { name: string; arguments: string } }[] | undefined)?.map((c) => `${c.function.name}(${c.function.arguments})`);
    console.log(`\n#${j} ${m.role}${calls ? ` calls ${calls.join(', ')}` : ''}:\n${preview(m.content)}`);
  }
  break;
}
if (pics !== 403) console.log('\nWithout pictures it goes through: the provider refuses a picture (snapshot).');
