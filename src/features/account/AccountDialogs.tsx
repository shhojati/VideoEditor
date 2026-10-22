// Log in / register, and the account dialog (plan, how to buy Pro on Telegram, password, log out).
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { Button } from '../../app/ui';
import { ApiError } from '../../lib/api';
import { loadPricing, type PricingConfig } from '../../lib/appConfig';
import { changePassword, login, logout, register, useAccount } from '../../store/account';
import { afterLogin, dropPendingAi } from './aiGate';
import { isPro, proDaysLeft } from './policy';

export const useAccountUi = create<{ dialog: 'auth' | 'account' | null }>()(() => ({ dialog: null }));
export const openAuth = () => useAccountUi.setState({ dialog: 'auth' });
export const openAccount = () => useAccountUi.setState({ dialog: 'account' });
const close = () => useAccountUi.setState({ dialog: null });
/** Closed without logging in: an AI action that was waiting for the login is dropped. */
const cancel = () => {
  dropPendingAi();
  close();
};

export function usePricing() {
  const [pricing, setPricing] = useState<PricingConfig | null>(null);
  useEffect(() => void loadPricing().then(setPricing), []);
  return pricing;
}

export function AccountDialogs() {
  const dialog = useAccountUi((s) => s.dialog);
  const me = useAccount((s) => s.me);
  useEffect(() => {
    if (!dialog) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && cancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dialog]);
  if (dialog === 'auth' && !me) return <AuthDialog />;
  if (dialog === 'account' && me) return <AccountDialog />;
  if (dialog === 'account') return <AuthDialog />;
  return null;
}

function Modal({ title, testId, children }: { title: string; testId: string; children: ReactNode }) {
  return (
    // Above the export dialog (z-50), which can open these.
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`${testId}-title`}
      onClick={cancel}
    >
      <div
        className="max-h-[94vh] w-[min(400px,94vw)] space-y-3 overflow-y-auto rounded-lg border border-line bg-surface-1 p-4 text-sm shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        data-testid={testId}
      >
        <h2 id={`${testId}-title`} className="text-base font-semibold text-white">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );
}

const inputClass = 'w-full rounded bg-surface-3 px-2 py-1.5 text-sm';

function useErrorText() {
  const { t } = useTranslation();
  return (e: unknown) =>
    t(`account.errors.${e instanceof ApiError ? e.code : 'network'}`, { defaultValue: t('account.errors.network') });
}

function AuthDialog() {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await (mode === 'login' ? login(email, password) : register(email, password));
      close();
      afterLogin();
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={mode === 'login' ? t('account.login') : t('account.register')} testId="auth-dialog">
      <p className="text-xs text-neutral-400">{t('account.why')}</p>
      <form className="space-y-2" onSubmit={(e) => void submit(e)}>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-neutral-400">{t('account.email')}</span>
          <input
            className={inputClass}
            type="email"
            dir="ltr"
            autoComplete="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="auth-email"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-neutral-400">{t('account.password')}</span>
          <input
            className={inputClass}
            type="password"
            dir="ltr"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            required
            minLength={mode === 'register' ? 8 : undefined}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            data-testid="auth-password"
          />
          {mode === 'register' && <span className="text-neutral-500">{t('account.passwordHint')}</span>}
        </label>
        {error && (
          <p className="text-xs text-red-300" role="alert" data-testid="auth-error">
            {error}
          </p>
        )}
        <div className="flex items-center justify-between gap-2 pt-1">
          <button
            type="button"
            className="text-xs text-accent hover:underline"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError(null);
            }}
            data-testid="auth-switch"
          >
            {mode === 'login' ? t('account.noAccount') : t('account.haveAccount')}
          </button>
          <div className="flex gap-2">
            <Button onClick={cancel}>{t('account.cancel')}</Button>
            <button
              type="submit"
              disabled={busy}
              className="rounded bg-accent px-2.5 py-1 text-sm text-white disabled:opacity-40"
              data-testid="auth-submit"
            >
              {mode === 'login' ? t('account.login') : t('account.register')}
            </button>
          </div>
        </div>
        {mode === 'login' && <p className="text-xs text-neutral-500">{t('account.forgot')}</p>}
      </form>
    </Modal>
  );
}

export const formatToman = (n: number, lang: string) =>
  new Intl.NumberFormat(lang === 'fa' ? 'fa-IR' : 'en-US').format(n);

export const formatDate = (ms: number, lang: string) =>
  new Intl.DateTimeFormat(lang === 'fa' ? 'fa-IR' : 'en-GB', { dateStyle: 'medium' }).format(ms);

/** Plan, Pro passes and how to buy them, password change, log out. */
function AccountDialog() {
  const { t, i18n } = useTranslation();
  const me = useAccount((s) => s.me)!;
  const pricing = usePricing();
  const pro = isPro(me);
  const days = proDaysLeft(me);
  const [copied, setCopied] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const message = t('account.telegramMessage', { code: me.code, email: me.email });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message);
      setCopied(true);
    } catch {
      // clipboard blocked: the text is visible to copy by hand
    }
  };

  return (
    <Modal title={t('account.title')} testId="account-dialog">
      <div className="space-y-1 rounded border border-line bg-surface-2 p-2 text-xs">
        <div className="flex justify-between gap-2">
          <span className="text-neutral-400">{t('account.email')}</span>
          <span dir="ltr">{me.email}</span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-neutral-400">{t('account.code')}</span>
          <span dir="ltr" className="font-mono text-white" data-testid="account-code">
            {me.code}
          </span>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-neutral-400">{t('account.plan')}</span>
          <span data-testid="account-plan" data-plan={pro ? 'pro' : 'free'}>
            {pro
              ? t('account.proUntil', { date: formatDate(me.proUntil!, i18n.language), count: days })
              : t('account.free', { seconds: pricing?.freeMaxSeconds ?? 60 })}
          </span>
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="text-sm font-medium text-white">{pro ? t('account.renew') : t('account.upgrade')}</h3>
        <p className="text-xs text-neutral-400">{t('account.proFeatures')}</p>
        {pricing && pricing.passes.length > 0 && (
          <ul className="space-y-1 text-xs" data-testid="account-passes">
            {pricing.passes.map((p) => (
              <li key={p.months} className="flex justify-between rounded bg-surface-2 px-2 py-1">
                <span>{t('account.months', { count: p.months })}</span>
                <span>{t('account.toman', { price: formatToman(p.priceToman, i18n.language) })}</span>
              </li>
            ))}
          </ul>
        )}
        <ol className="list-decimal space-y-0.5 ps-5 text-xs text-neutral-300">
          <li>{t('account.step1')}</li>
          <li>{t('account.step2')}</li>
          <li>{t('account.step3')}</li>
        </ol>
        <p className="rounded bg-surface-2 p-2 text-xs select-all" data-testid="account-message">
          {message}
        </p>
        <div className="flex flex-wrap gap-2">
          {pricing?.telegram && (
            <a
              className="rounded bg-accent px-2.5 py-1 text-sm text-white"
              href={`https://t.me/${encodeURIComponent(pricing.telegram.replace(/^@/, ''))}`}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="account-telegram"
            >
              {t('account.openTelegram')}
            </a>
          )}
          <Button onClick={() => void copy()}>{copied ? t('account.copied') : t('account.copyMessage')}</Button>
        </div>
      </section>

      <section className="space-y-2 border-t border-line pt-2">
        <button type="button" className="text-xs text-accent hover:underline" onClick={() => setShowPassword(!showPassword)}>
          {t('account.changePassword')}
        </button>
        {showPassword && <ChangePassword onDone={() => setShowPassword(false)} />}
      </section>

      <div className="flex justify-between gap-2 border-t border-line pt-2">
        <Button onClick={() => void logout().then(close)} data-testid="account-logout">
          {t('account.logout')}
        </Button>
        <Button onClick={close}>{t('account.close')}</Button>
      </div>
    </Modal>
  );
}

function ChangePassword({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const errorText = useErrorText();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await changePassword(current, next);
      setStatus(null);
      onDone();
    } catch (err) {
      setStatus(errorText(err));
    }
  };
  return (
    <form className="space-y-2" onSubmit={(e) => void submit(e)}>
      <input
        className={inputClass}
        type="password"
        dir="ltr"
        autoComplete="current-password"
        placeholder={t('account.currentPassword')}
        aria-label={t('account.currentPassword')}
        required
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
      />
      <input
        className={inputClass}
        type="password"
        dir="ltr"
        autoComplete="new-password"
        placeholder={t('account.newPassword')}
        aria-label={t('account.newPassword')}
        required
        minLength={8}
        value={next}
        onChange={(e) => setNext(e.target.value)}
      />
      {status && (
        <p className="text-xs text-red-300" role="alert">
          {status}
        </p>
      )}
      <button type="submit" className="rounded bg-surface-3 px-2.5 py-1 text-sm">
        {t('account.savePassword')}
      </button>
    </form>
  );
}

/** Top bar: "Log in", or the account with its plan. */
export function AccountButton() {
  const { t } = useTranslation();
  const me = useAccount((s) => s.me);
  if (!me)
    return (
      <Button onClick={openAuth} data-testid="account-button">
        {t('account.login')}
      </Button>
    );
  const pro = isPro(me);
  const days = proDaysLeft(me);
  return (
    <Button onClick={openAccount} data-testid="account-button" title={me.email}>
      <span
        className={`rounded px-1 text-[10px] font-bold ${pro ? (days <= 3 ? 'bg-amber-500 text-black' : 'bg-emerald-800 text-white') : 'bg-neutral-600 text-white'}`}
      >
        {pro ? t('account.proBadge') : t('account.freeBadge')}
      </span>
      <span className="ms-1 max-md:hidden">
        {pro && days <= 3 ? t('account.daysLeft', { count: days }) : t('account.account')}
      </span>
    </Button>
  );
}
