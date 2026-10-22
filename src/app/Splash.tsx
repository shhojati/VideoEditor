import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

/** How long the opening screen stays (ms), then how long it fades. */
export const SPLASH_MS = 1000;
const FADE_MS = 250;

/**
 * The opening screen: logo, name and a loading bar that fills in SPLASH_MS while the editor starts
 * underneath. index.html shows the same picture before the scripts load. Skipped under browser
 * automation (navigator.webdriver), so end-to-end tests do not wait for it.
 */
export function Splash() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<'start' | 'fill' | 'out' | 'gone'>(() => (navigator.webdriver ? 'gone' : 'start'));

  useEffect(() => {
    if (phase === 'gone') return;
    // One frame at 0% first, so the bar's width transition runs.
    const raf = requestAnimationFrame(() => setPhase('fill'));
    const out = setTimeout(() => setPhase('out'), SPLASH_MS);
    const gone = setTimeout(() => setPhase('gone'), SPLASH_MS + FADE_MS);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(out);
      clearTimeout(gone);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once, on startup
  }, []);

  if (phase === 'gone') return null;
  return (
    <div
      className={`fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-surface-0 transition-opacity ${phase === 'out' ? 'pointer-events-none opacity-0' : ''}`}
      style={{ transitionDuration: `${FADE_MS}ms` }}
      role="status"
      aria-live="polite"
      data-testid="splash"
    >
      <img src="/favicon.svg" alt="" className="h-16 w-16" />
      <div className="text-lg font-semibold text-white">{t('app.title')}</div>
      <div className="h-1 w-48 overflow-hidden rounded-full bg-surface-3">
        <div
          className="h-full rounded-full bg-accent transition-[width] ease-out"
          style={{ width: phase === 'start' ? '0%' : '100%', transitionDuration: `${SPLASH_MS}ms` }}
        />
      </div>
      <div className="text-xs text-neutral-400">{t('app.loading')}</div>
    </div>
  );
}
