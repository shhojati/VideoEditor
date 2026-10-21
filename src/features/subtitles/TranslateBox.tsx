import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../app/ui';
import type { SubtitleTrack } from '../../model/types';
import type { TranslateQuality } from '../../workers/translate.worker';
import { cancelTranslate, checkTranslateModels, translateTrack, useTranslate } from './translateService';

const SIZE_MB: Record<TranslateQuality, number> = { standard: 630, precise: 1200 };

/** English → Persian translation of the active subtitle track, into a new track (Pro). */
export function TranslateBox({ track }: { track: SubtitleTrack }) {
  const { t } = useTranslation();
  const state = useTranslate();
  const [picked, setPicked] = useState<TranslateQuality>('standard');
  useEffect(() => void checkTranslateModels(), []);
  // If the picked version is not installed, use the one that is.
  const quality: TranslateQuality = state.installed[picked] === false && state.installed.standard ? 'standard' : state.installed[picked] === false && state.installed.precise ? 'precise' : picked;
  const busy = state.stage === 'loading' || state.stage === 'translating';
  const mine = state.trackId === track.id || !busy;

  return (
    <section className="space-y-2 rounded border border-line bg-surface-2/60 p-2" data-testid="translate-box">
      <div className="flex items-center gap-2 font-medium">
        <span>🌐</span>
        <span className="flex-1">{t('translate.title')}</span>
        <span className="text-[10px] text-amber-300">PRO</span>
      </div>
      <label className="flex items-center gap-2">
        <span className="w-16 text-neutral-400">{t('translate.quality')}</span>
        <select className="flex-1 rounded bg-surface-3 px-1 py-1" value={quality} disabled={busy} data-testid="translate-quality" onChange={(e) => setPicked(e.target.value as TranslateQuality)}>
          {(['standard', 'precise'] as const).map((q) => (
            <option key={q} value={q} disabled={state.installed[q] === false}>
              {t(`translate.qualities.${q}`)} · ~{SIZE_MB[q]} MB {state.installed[q] === false ? `— ${t('stt.notInstalled')}` : state.installed[q] ? '✓' : ''}
            </option>
          ))}
        </select>
      </label>
      {busy && mine ? (
        <div className="space-y-1" data-testid="translate-progress">
          <div className="text-neutral-300">
            {state.stage === 'loading' ? `${t('translate.loading')} ${Math.round(state.loading ?? 0)}%` : t('translate.running', { pct: Math.round(state.progress * 100) })}
          </div>
          <div className="h-1.5 rounded bg-surface-3">
            <div className="h-1.5 rounded bg-accent" style={{ width: `${Math.round(state.progress * 100)}%` }} />
          </div>
          <Button className="text-xs" onClick={cancelTranslate}>
            {t('stt.cancel')}
          </Button>
        </div>
      ) : (
        <Button className="w-full bg-accent/70! text-xs" disabled={busy || state.installed[quality] === false} data-testid="translate-start" onClick={() => void translateTrack(track.id, quality)}>
          {t('translate.start')}
        </Button>
      )}
      {state.stage === 'done' && <p className="text-emerald-300" data-testid="translate-done">{t('translate.done')}</p>}
      {state.stage === 'error' && (
        <p className="text-red-300" role="alert">
          {t(`translate.errors.${state.error}`)}
        </p>
      )}
      <p className="text-[11px] text-neutral-400">{t('translate.hint')}</p>
    </section>
  );
}
