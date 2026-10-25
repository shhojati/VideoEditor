import { X } from 'lucide-react';
import { Icon } from './icons';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { checkCapabilities, type Capability } from './capabilities';

const DISMISS_KEY = 'capability-notice-dismissed';

/**
 * Runs the capability check once. Missing required features replace the app with an explanation;
 * missing optional ones show a dismissible notice above it.
 */
export function StartupCheck({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [caps, setCaps] = useState<Capability[] | null>(null);
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    void checkCapabilities().then(setCaps);
  }, []);

  if (!caps) return null;
  const missingRequired = caps.filter((c) => c.required && !c.ok);
  const missingOptional = caps.filter((c) => !c.required && !c.ok);

  if (missingRequired.length) {
    return (
      <div className="flex h-full items-center justify-center p-6" role="alert" data-testid="unsupported">
        <div className="max-w-xl space-y-3 rounded-lg border border-red-900 bg-surface-1 p-6">
          <h1 className="text-lg font-semibold text-white">{t('caps.blockedTitle')}</h1>
          <ul className="list-disc space-y-1 ps-5 text-sm text-neutral-300">
            {missingRequired.map((c) => (
              <li key={c.id}>{t(`caps.items.${c.id}`)}</li>
            ))}
          </ul>
          <p className="text-sm text-neutral-400">{t('caps.blockedHelp')}</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {missingOptional.length > 0 && !dismissed && (
        <div className="flex items-start gap-3 bg-amber-900/60 px-4 py-1.5 text-xs text-amber-100" role="status" data-testid="capability-notice">
          <ul className="flex-1 space-y-0.5">
            {missingOptional.map((c) => (
              <li key={c.id}>{t(`caps.items.${c.id}`)}</li>
            ))}
          </ul>
          <button
            className="rounded-md px-2 hover:bg-amber-800"
            aria-label={t('media.dismiss')}
            onClick={() => {
              setDismissed(true);
              try {
                localStorage.setItem(DISMISS_KEY, '1');
              } catch {
                // not remembered; fine
              }
            }}
          >
            <Icon icon={X} size={16} />
          </button>
        </div>
      )}
      {children}
    </>
  );
}
