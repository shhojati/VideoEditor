import { X } from 'lucide-react';
import { Icon } from './icons';
import type { TFunction } from 'i18next';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';

interface Toast {
  id: number;
  message: string;
}

export const useToasts = create<{ toasts: Toast[] }>()(() => ({ toasts: [] }));

let nextId = 1;
export function showToast(message: string) {
  // Same message twice in a row is shown once.
  if (useToasts.getState().toasts.some((t) => t.message === message)) return;
  const id = nextId++;
  useToasts.setState((s) => ({ toasts: [...s.toasts.slice(-3), { id, message }] }));
  setTimeout(() => dismissToast(id), 10_000);
}

export const dismissToast = (id: number) => useToasts.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

/** Turns low-level errors into something a user can act on. */
export function friendlyError(err: unknown, t: TFunction): string {
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  if (/QuotaExceeded|quota/i.test(msg)) return t('errors.quota');
  if (/allocation failed|out of memory|RangeError: Array buffer/i.test(msg)) return t('errors.memory');
  return t('errors.unexpected', { message: msg.slice(0, 200) });
}

/** Unhandled errors anywhere end up as a toast instead of failing silently. */
export function Toasts() {
  const { t } = useTranslation();
  const toasts = useToasts((s) => s.toasts);
  useEffect(() => {
    const onError = (e: ErrorEvent) => showToast(friendlyError(e.error ?? e.message, t));
    const onRejection = (e: PromiseRejectionEvent) => showToast(friendlyError(e.reason, t));
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, [t]);
  return (
    <div className="pointer-events-none fixed bottom-4 start-4 z-50 flex w-[min(420px,90vw)] flex-col gap-2" aria-live="assertive">
      {toasts.map((toast) => (
        <div key={toast.id} role="alert" className="pointer-events-auto flex items-start gap-2 rounded border border-red-800 bg-surface-2 p-3 text-sm shadow-xl">
          <span className="flex-1">{toast.message}</span>
          <button onClick={() => dismissToast(toast.id)} aria-label={t('media.dismiss')} className="text-neutral-400 hover:text-white">
            <Icon icon={X} size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
