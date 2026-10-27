// "AI agent" in the top bar: turns Agent access on or off for this tab, shows the address to give
// an AI app, the latest calls, and the apps connected to the account.
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot, Check, Copy, X } from 'lucide-react';
import { Button } from '../../app/ui';
import { Icon } from '../../app/icons';
import { useAccount } from '../../store/account';
import { openAuth } from '../account/AccountDialogs';
import { disconnectApp, listConnectedApps, startAgent, stopAgent, useAgent, type ConnectedApp } from './bridge';

export function AgentButton() {
  const { t } = useTranslation();
  const status = useAgent((s) => s.status);
  const [open, setOpen] = useState(false);
  return (
    <>
      {/* Not on phones: the top bar has no room, and agents are a desktop workflow. */}
      <Button className="max-md:hidden" onClick={() => setOpen(true)} data-testid="agent-button" data-status={status} aria-label={t('agent.open')} title={t(`agent.status.${status}`)}>
        <span className="relative">
          <Icon icon={Bot} />
          {status !== 'off' && (
            <span
              className={`absolute -end-0.5 -top-0.5 h-2 w-2 rounded-full ${status === 'on' ? 'bg-emerald-500' : status === 'error' ? 'bg-red-500' : 'bg-amber-400'}`}
              aria-hidden
            />
          )}
        </span>
        <span className="max-lg:hidden">{t('agent.button')}</span>
      </Button>
      {open && <AgentDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function AgentDialog({ onClose }: { onClose: () => void }) {
  const { t, i18n } = useTranslation();
  const me = useAccount((s) => s.me);
  const { status, log } = useAgent();
  const [copied, setCopied] = useState(false);
  const [apps, setApps] = useState<ConnectedApp[] | null>(null);
  const url = `${location.origin}/mcp`;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  useEffect(() => {
    if (me) listConnectedApps().then(setApps, () => setApps([]));
  }, [me]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // clipboard blocked: the address is visible to copy by hand
    }
  };
  const time = (ms: number) => new Date(ms).toLocaleTimeString(i18n.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby="agent-title" onClick={onClose}>
      <div
        className="max-h-[94vh] w-[min(440px,94vw)] space-y-3 overflow-y-auto rounded-lg border border-line bg-surface-1 p-4 text-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid="agent-dialog"
      >
        <div className="flex items-center justify-between">
          <h2 id="agent-title" className="text-base font-semibold text-white">
            {t('agent.title')}
          </h2>
          <Button variant="ghost" onClick={onClose} aria-label={t('account.close')}>
            <Icon icon={X} />
          </Button>
        </div>
        <p className="text-neutral-300">{t('agent.intro')}</p>

        <div className="space-y-1">
          <div className="text-xs text-neutral-400">{t('agent.address')}</div>
          <div className="flex gap-2">
            <code dir="ltr" className="flex-1 truncate rounded bg-surface-3 px-2 py-1.5 font-mono text-xs" data-testid="agent-url">
              {url}
            </code>
            <Button onClick={() => void copy()} aria-label={t('agent.copy')}>
              <Icon icon={copied ? Check : Copy} />
            </Button>
          </div>
          <p className="text-xs text-neutral-400">{t('agent.addressHint')}</p>
        </div>

        {!me ? (
          <Button variant="primary" onClick={openAuth}>
            {t('agent.loginFirst')}
          </Button>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded border border-line bg-surface-2 p-2">
            <span data-testid="agent-status">{t(`agent.status.${status}`)}</span>
            {status === 'off' || status === 'error' ? (
              <Button variant="primary" onClick={startAgent} data-testid="agent-start">
                {t('agent.start')}
              </Button>
            ) : (
              <Button onClick={stopAgent} data-testid="agent-stop">
                {t('agent.stop')}
              </Button>
            )}
          </div>
        )}
        <p className="text-xs text-neutral-400">{t('agent.safety')}</p>

        {log.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs text-neutral-400">{t('agent.recent')}</div>
            <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded bg-surface-2 p-2 font-mono text-xs" dir="ltr" data-testid="agent-log">
              {log.map((c, i) => (
                <li key={i} className="flex justify-between gap-2">
                  <span className={c.ok ? 'text-neutral-200' : 'text-red-400'}>{c.tool}</span>
                  <span className="text-neutral-500">{time(c.at)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {me && !!apps?.length && (
          <div className="space-y-1">
            <div className="text-xs text-neutral-400">{t('agent.apps')}</div>
            <ul className="space-y-1">
              {apps.map((a) => (
                <li key={a.clientId} className="flex items-center justify-between gap-2 rounded bg-surface-2 px-2 py-1">
                  <span dir="auto" className="truncate">
                    {a.name}
                  </span>
                  <Button
                    variant="ghost"
                    onClick={() => void disconnectApp(a.clientId).then(() => setApps((l) => l?.filter((x) => x.clientId !== a.clientId) ?? null))}
                  >
                    {t('agent.disconnect')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
