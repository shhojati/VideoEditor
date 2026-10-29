// The AI chat: the user asks in words, the model edits the project with the agent tools.
import { Check, LoaderCircle, Send, Sparkles, Square, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../app/icons';
import { Button, Panel } from '../../app/ui';
import { useAccount } from '../../store/account';
import { openAccount, openAuth } from '../account/AccountDialogs';
import type { ChatMessage } from './chatLoop';
import { clearChat, sendChat, stopChat, useChat, type CallState } from './chatStore';

const EXAMPLES = ['chat.example1', 'chat.example2', 'chat.example3'];

export function ChatPanel({ actions }: { actions?: ReactNode }) {
  const { t } = useTranslation();
  const me = useAccount((s) => s.me);
  const enabled = useAccount((s) => s.chat);
  const { messages, calls, busy, error } = useChat();
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, busy, error]);

  const submit = (value = text) => {
    if (!value.trim() || busy) return;
    setText('');
    void sendChat(value);
  };

  const body = !enabled ? (
    <p className="p-3 text-xs text-muted md:px-4">{t('chat.disabled')}</p>
  ) : !me ? (
    <div className="space-y-2 p-3 text-xs md:px-4">
      <p className="text-muted">{t('chat.loginFirst')}</p>
      <Button variant="primary" onClick={openAuth} data-testid="chat-login">
        {t('account.login')}
      </Button>
    </div>
  ) : (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={listRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3 text-sm md:px-4" data-testid="chat-messages">
        {messages.length === 0 && (
          <div className="space-y-2 text-xs text-muted">
            <p>{t('chat.intro')}</p>
            {EXAMPLES.map((k) => (
              <button
                key={k}
                type="button"
                className="block w-full rounded-md border border-line bg-surface-2 px-2 py-1.5 text-start text-neutral-200 hover:bg-surface-3"
                onClick={() => submit(t(k))}
              >
                {t(k)}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <Message key={i} message={m} calls={calls} />
        ))}
        {busy && (
          <p className="flex items-center gap-1.5 text-xs text-muted" data-testid="chat-busy">
            <Icon icon={LoaderCircle} size={14} className="animate-spin" />
            {t('chat.working')}
          </p>
        )}
        {error && (
          <div className="space-y-1.5 rounded-md border border-red-900 bg-red-950/40 p-2 text-xs text-red-200" role="alert" data-testid="chat-error">
            <p>{t(`chat.errors.${error}`, { defaultValue: t(`account.errors.${error}`, { defaultValue: t('account.errors.network') }) })}</p>
            {error === 'no_credits' && (
              <Button variant="primary" onClick={openAccount}>
                {t('chat.buy')}
              </Button>
            )}
          </div>
        )}
      </div>
      <form
        className="space-y-1.5 border-t border-line p-2 md:px-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <textarea
          className="block max-h-40 min-h-[3.5rem] w-full resize-y rounded-md bg-surface-3 px-2 py-1.5 text-sm"
          placeholder={t('chat.placeholder')}
          aria-label={t('chat.placeholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              submit();
            }
          }}
          data-testid="chat-input"
        />
        <div className="flex items-center gap-2 text-xs">
          <button type="button" className="text-accent hover:underline" onClick={openAccount} data-testid="chat-credits">
            {t('chat.credits', { count: me.credits })}
          </button>
          <span className="flex-1" />
          <Button className="text-xs" variant="ghost" onClick={clearChat} disabled={busy || !messages.length} title={t('chat.clear')} aria-label={t('chat.clear')}>
            <Icon icon={Trash2} size={14} />
          </Button>
          {busy ? (
            <Button className="text-xs" onClick={stopChat} data-testid="chat-stop">
              <Icon icon={Square} size={14} />
              {t('chat.stop')}
            </Button>
          ) : (
            <Button type="submit" className="text-xs" variant="primary" disabled={!text.trim()} data-testid="chat-send">
              <Icon icon={Send} size={14} />
              {t('chat.send')}
            </Button>
          )}
        </div>
      </form>
    </div>
  );

  return (
    <Panel title={t('chat.title')} actions={actions}>
      {body}
    </Panel>
  );
}

function Message({ message: m, calls }: { message: ChatMessage; calls: Record<string, CallState> }) {
  const { t } = useTranslation();
  if (m.role === 'tool') return null;
  if (m.role === 'user') {
    if (typeof m.content === 'string')
      return (
        <p className="ms-6 rounded-lg bg-accent-soft px-2.5 py-1.5 whitespace-pre-wrap text-neutral-100" data-testid="chat-user">
          {m.content}
        </p>
      );
    // A snapshot the model asked for.
    const pics = m.content.flatMap((p) => (p.type === 'image_url' ? [p.image_url.url] : []));
    return (
      <div className="flex gap-1">
        {pics.map((url, i) => (
          <img key={i} src={url} alt={t('chat.snapshot')} className="max-h-20 rounded border border-line" />
        ))}
      </div>
    );
  }
  return (
    <div className="space-y-1">
      {m.tool_calls?.length ? (
        <div className="flex flex-wrap gap-1">
          {m.tool_calls.map((c) => {
            const state = calls[c.id] ?? 'running';
            return (
              <span
                key={c.id}
                className={`inline-flex items-center gap-1 rounded bg-surface-3 px-1.5 py-0.5 font-mono text-[11px] ${state === 'error' ? 'text-red-300' : 'text-neutral-300'}`}
                data-testid="chat-call"
                data-state={state}
              >
                <Icon icon={state === 'running' ? LoaderCircle : state === 'ok' ? Check : TriangleAlert} size={12} className={state === 'running' ? 'animate-spin' : ''} />
                {c.function.name}
              </span>
            );
          })}
        </div>
      ) : null}
      {m.content && (
        <p className="me-6 flex gap-1.5 rounded-lg bg-surface-2 px-2.5 py-1.5 whitespace-pre-wrap text-neutral-100" data-testid="chat-assistant">
          <Icon icon={Sparkles} size={14} className="mt-0.5 shrink-0 text-accent" />
          <span className="min-w-0">{m.content}</span>
        </p>
      )}
    </div>
  );
}
