import { useTranslation } from 'react-i18next';

/** Chromium-only features the editor depends on (plan §2.2). */
export function isFullySupported() {
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoDecoder !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined'
  );
}

export function BrowserNotice() {
  const { t } = useTranslation();
  if (isFullySupported()) return null;
  return <div className="bg-amber-900/60 px-4 py-1.5 text-sm text-amber-100">{t('browser.limited')}</div>;
}
