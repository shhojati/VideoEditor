import { ChevronDown, ChevronRight, Mic } from 'lucide-react';
import { Icon } from '../../app/icons';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../app/ui';
import { defaultSize, heavyModel, isPhone, WHISPER_SIZES, type WhisperSize } from '../../engine/stt/models';
import { findClip } from '../../model/timeline';
import type { Project } from '../../model/types';
import { useTimelineUi } from '../timeline/timelineUi';
import { cancelAutoSubtitles, checkModels, startAutoSubtitles, useStt } from './sttService';

const LANGS = ['fa', 'en', 'ar', 'auto'] as const;
// Download per device (WebGPU, WASM): encoder + that device's decoder.
const MODEL_SIZE_MB: Record<WhisperSize, [number, number]> = { tiny: [120, 65], base: [210, 140], small: [590, 510], 'large-v3-turbo': [760, 1090] };

export function AutoSubtitles({ project }: { project: Project }) {
  const { t } = useTranslation();
  const all = useStt();
  // Transcripts for text-based editing share the speech-to-text worker; their progress shows there.
  const stt = all.target === 'transcript' ? { ...all, stage: 'idle' as const } : all;
  const [open, setOpen] = useState(false);
  // Until the user picks one: the most accurate installed model (turbo once checkModels finds it).
  const [picked, setModel] = useState<WhisperSize | null>(null);
  const wanted = picked ?? defaultSize(stt.models);
  // If the picked model is not installed, use the best one that is.
  const model =
    stt.models[wanted] === false ? ([...WHISPER_SIZES].reverse().find((s) => stt.models[s]) ?? wanted) : wanted;
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
        <Icon icon={Mic} size={16} />
        <span className="flex-1">{t('stt.title')}</span>
        {busy && <span className="text-accent">{Math.round(stt.progress * 100)}%</span>}
        <Icon icon={open || busy ? ChevronDown : ChevronRight} size={16} className={open || busy ? '' : 'rtl:-scale-x-100'} />
      </button>
      {(open || busy || stt.stage === 'done' || stt.stage === 'error') && (
        <div className="space-y-2 border-t border-line p-2">
          <label className="flex items-center gap-2">
            <span className="w-16 text-neutral-400">{t('stt.model')}</span>
            <select className="flex-1 rounded bg-surface-3 px-1 py-1" value={model} disabled={busy} onChange={(e) => setModel(e.target.value as WhisperSize)} data-testid="stt-model">
              {WHISPER_SIZES.map((s) => (
                <option key={s} value={s} disabled={stt.models[s] === false}>
                  {t(`stt.models.${s}`)} · ~{MODEL_SIZE_MB[s][stt.device === 'wasm' ? 1 : 0]} MB {stt.models[s] === false ? `— ${t('stt.notInstalled')}` : stt.models[s] ? '✓' : ''}
                </option>
              ))}
            </select>
          </label>
          {heavyModel(model) && isPhone() && (
            <p className="text-[11px] text-amber-300" data-testid="stt-heavy-phone">
              {t('stt.heavyOnPhone')}
            </p>
          )}
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
