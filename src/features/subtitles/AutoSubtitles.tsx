import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../app/ui';
import { WHISPER_SIZES, type WhisperSize } from '../../engine/stt/models';
import { findClip } from '../../model/timeline';
import type { Project } from '../../model/types';
import { useTimelineUi } from '../timeline/timelineUi';
import { cancelAutoSubtitles, checkModels, startAutoSubtitles, useStt } from './sttService';

const LANGS = ['fa', 'en', 'ar', 'auto'] as const;
const MODEL_SIZE_MB: Record<WhisperSize, number> = { tiny: 150, base: 250, small: 700 };

export function AutoSubtitles({ project }: { project: Project }) {
  const { t } = useTranslation();
  const stt = useStt();
  const [open, setOpen] = useState(false);
  // small is the recommended default for Persian (see docs/SPIKES.md).
  const [picked, setModel] = useState<WhisperSize>('small');
  // If the picked model is not installed, use the best one that is.
  const model =
    stt.models[picked] === false ? ([...WHISPER_SIZES].reverse().find((s) => stt.models[s]) ?? picked) : picked;
  const [lang, setLang] = useState<(typeof LANGS)[number]>('fa');
  const [selectedOnly, setSelectedOnly] = useState(false);
  const hasSelectedClip = useTimelineUi((s) => s.selection.some((id) => findClip(project, id)));
  const busy = stt.stage === 'extracting' || stt.stage === 'loading' || stt.stage === 'transcribing';

  useEffect(() => {
    if (open) void checkModels();
  }, [open]);

  return (
    <section className="rounded border border-line bg-surface-2/60" data-testid="auto-subtitles">
      <button className="flex w-full items-center gap-2 px-2 py-1.5 text-start font-medium" onClick={() => setOpen((o) => !o)} aria-expanded={open || busy}>
        <span>🎙</span>
        <span className="flex-1">{t('stt.title')}</span>
        {busy && <span className="text-accent">{Math.round(stt.progress * 100)}%</span>}
        <span>{open || busy ? '▾' : '▸'}</span>
      </button>
      {(open || busy || stt.stage === 'done' || stt.stage === 'error') && (
        <div className="space-y-2 border-t border-line p-2">
          <label className="flex items-center gap-2">
            <span className="w-16 text-neutral-400">{t('stt.model')}</span>
            <select className="flex-1 rounded bg-surface-3 px-1 py-1" value={model} disabled={busy} onChange={(e) => setModel(e.target.value as WhisperSize)} data-testid="stt-model">
              {WHISPER_SIZES.map((s) => (
                <option key={s} value={s} disabled={stt.models[s] === false}>
                  {t(`stt.models.${s}`)} · ~{MODEL_SIZE_MB[s]} MB {stt.models[s] === false ? `— ${t('stt.notInstalled')}` : stt.models[s] ? '✓' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="w-16 text-neutral-400">{t('stt.language')}</span>
            <select className="flex-1 rounded bg-surface-3 px-1 py-1" value={lang} disabled={busy} onChange={(e) => setLang(e.target.value as typeof lang)} data-testid="stt-language">
              {LANGS.map((l) => (
                <option key={l} value={l}>
                  {l === 'auto' ? t('stt.autoDetect') : t(`subtitles.languages.${l}`)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={selectedOnly && hasSelectedClip} disabled={!hasSelectedClip || busy} onChange={(e) => setSelectedOnly(e.target.checked)} />
            <span className={hasSelectedClip ? '' : 'text-neutral-400'}>{t('stt.selectedOnly')}</span>
          </label>

          {busy ? (
            <div className="space-y-1" data-testid="stt-progress">
              <div className="text-neutral-300">
                {t(`stt.stage.${stt.stage}`)}
                {stt.stage === 'loading' && stt.loading !== undefined ? ` ${Math.round(stt.loading)}%` : ''}
              </div>
              <div className="h-1.5 rounded bg-surface-3">
                <div className="h-1.5 rounded bg-accent transition-[width]" style={{ width: `${Math.round(stt.progress * 100)}%` }} />
              </div>
              {stt.rtf !== undefined && (
                <div className="text-neutral-400" dir="ltr">
                  {t('stt.speed', { rtf: stt.rtf.toFixed(2), device: stt.device === 'webgpu' ? 'WebGPU' : 'WASM' })}
                </div>
              )}
              <Button className="text-xs" onClick={cancelAutoSubtitles}>
                {t('stt.cancel')}
              </Button>
              <p className="text-neutral-400">{t('stt.background')}</p>
            </div>
          ) : (
            <Button
              className="w-full bg-accent/70! text-xs"
              disabled={stt.models[model] === false}
              data-testid="stt-start"
              onClick={() => void startAutoSubtitles({ model, language: lang === 'auto' ? null : lang, selectedOnly })}
            >
              {t('stt.start')}
            </Button>
          )}

          {stt.stage === 'done' && (
            <p className="text-emerald-300" role="status" data-testid="stt-done">
              {stt.created ? t('stt.done', { count: stt.created }) : t('stt.nothing')}
            </p>
          )}
          {stt.stage === 'error' && (
            <p className="text-red-300" role="alert">
              {t(`stt.errors.${stt.error}`)}
              {stt.detail && <span className="block text-[10px] text-neutral-400" dir="ltr">{stt.detail}</span>}
            </p>
          )}
          {stt.models[model] && stt.wordModels[model] === false && (
            <p className="text-[11px] text-amber-300" data-testid="stt-no-words">{t('stt.noWordTimings')}</p>
          )}
          {Object.values(stt.models).some((v) => v === false) && <p className="text-[11px] text-neutral-400">{t('stt.installHint')}</p>}
        </div>
      )}
    </section>
  );
}
