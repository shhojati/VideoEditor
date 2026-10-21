import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NORMALIZE_TARGET, normalizeGain } from '../../engine/audio/cleanDsp';
import type { Clip, Project } from '../../model/types';
import { clipLoudness, ensureNoiseProfile } from '../media-bin/audioAnalysis';
import type { SetFn } from './ClipInspector';
import { NumberField, Section } from './controls';

/** Noise reduction, Enhance voice and Normalize for an audible clip. */
export function CleanupSection({ project, clip, set }: { project: Project; clip: Clip; set: SetFn }) {
  const { t } = useTranslation();
  const [measuring, setMeasuring] = useState(false);
  const [failed, setFailed] = useState(false);
  const clean = clip.audio.clean;
  // Make the noise profile as soon as cleanup is turned on, so playback has it.
  const prepare = () => clip.assetId && void ensureNoiseProfile(project, clip.assetId);

  const normalize = async () => {
    setMeasuring(true);
    setFailed(false);
    try {
      const lufs = await clipLoudness(project, clip);
      if (!Number.isFinite(lufs)) setFailed(true);
      else set('gainDb', (c) => void (c.audio.gainDb = normalizeGain(lufs)));
    } catch {
      setFailed(true);
    } finally {
      setMeasuring(false);
    }
  };

  return (
    <Section title={t('cleanup.title')}>
      <NumberField
        label={t('cleanup.denoise')}
        value={clean?.denoise ?? 0}
        min={0}
        max={1}
        factor={100}
        unit="%"
        onChange={(v) => {
          if (v > 0) prepare();
          set('clean.denoise', (c) => {
            c.audio.clean = { ...c.audio.clean, denoise: v };
            if (!v && !c.audio.clean.enhance) delete c.audio.clean;
          });
        }}
      />
      <label className="flex items-center gap-2 text-xs text-neutral-300">
        <input
          type="checkbox"
          data-testid="enhance-voice"
          checked={!!clean?.enhance}
          onChange={(e) => {
            const on = e.target.checked;
            if (on) prepare();
            set('clean.enhance', (c) => {
              c.audio.clean = { denoise: c.audio.clean?.denoise ?? 0, ...(on && { enhance: true }) };
              if (!on && !c.audio.clean.denoise) delete c.audio.clean;
            });
          }}
        />
        {t('cleanup.enhance')}
      </label>
      <div className="flex items-center gap-2 text-xs">
        <button
          className="rounded bg-surface-3 px-2 py-1 hover:bg-[#363c49] disabled:opacity-40"
          data-testid="normalize"
          disabled={measuring}
          title={t('cleanup.normalizeHint', { target: NORMALIZE_TARGET })}
          onClick={() => void normalize()}
        >
          {measuring ? t('cleanup.measuring') : t('cleanup.normalize')}
        </button>
        {!!clip.audio.gainDb && (
          <>
            <span className="text-neutral-300" data-testid="gain-db" dir="ltr">
              {clip.audio.gainDb > 0 ? '+' : ''}
              {clip.audio.gainDb} dB
            </span>
            <button className="text-neutral-400 hover:text-white" aria-label={t('cleanup.resetGain')} title={t('cleanup.resetGain')} onClick={() => set('gainDb', (c) => void delete c.audio.gainDb)}>
              ✕
            </button>
          </>
        )}
      </div>
      {failed && <p className="text-[11px] text-red-300">{t('cleanup.silent')}</p>}
      {!!clean && <p className="text-[11px] text-neutral-400">{t('cleanup.hint')}</p>}
    </Section>
  );
}
