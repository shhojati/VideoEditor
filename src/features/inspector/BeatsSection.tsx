import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Asset, Clip } from '../../model/types';
import { clearBeats, detectClipBeats } from '../timeline/beatActions';
import { Section } from './controls';

/** Tempo and beat detection for a clip's music (the beats show on the timeline and snap). */
export function BeatsSection({ clip, asset }: { clip: Clip; asset: Asset }) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [none, setNone] = useState(false);
  const detect = async () => {
    setBusy(true);
    setNone(false);
    try {
      setNone(!(await detectClipBeats(clip.id)));
    } catch {
      setNone(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section id="beats" title={t('beats.title')} onReset={asset.beats ? () => clearBeats(asset.id) : undefined}>
      <div className="flex items-center gap-2 text-xs">
        {asset.beats ? (
          <>
            <span className="text-neutral-200" data-testid="beats-info">
              ♪ {t('beats.info', { bpm: asset.beats.bpm, count: asset.beats.times.length })}
            </span>
            <button className="text-neutral-400 hover:text-white" aria-label={t('beats.clear')} title={t('beats.clear')} onClick={() => clearBeats(asset.id)}>
              ✕
            </button>
          </>
        ) : (
          <button className="rounded bg-surface-3 px-2 py-1 hover:bg-[#363c49] disabled:opacity-40" data-testid="detect-beats" disabled={busy} onClick={() => void detect()}>
            {busy ? t('beats.detecting') : `♪ ${t('beats.detect')}`}
          </button>
        )}
      </div>
      {none && <p className="text-[11px] text-red-300">{t('beats.none')}</p>}
      <p className="text-[11px] text-neutral-400">{t('beats.hint')}</p>
    </Section>
  );
}
