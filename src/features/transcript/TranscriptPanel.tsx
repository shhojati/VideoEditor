import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../app/ui';
import { formatDuration } from '../../lib/time';
import { heavyModel, isPhone, WHISPER_SIZES, type WhisperSize } from '../../engine/stt/models';
import { isFiller } from '../../model/transcript';
import type { Project } from '../../model/types';
import { useTransport } from '../../store/transport';
import { cancelAutoSubtitles, checkModels, transcribeClips, useStt } from '../subtitles/sttService';
import { useTimelineUi } from '../timeline/timelineUi';
import { cutRanges, removals, transcriptClips, wordsRange, type Removal } from './transcriptActions';
import { ProBadge } from '../account/ProBadge';

const LANGS = ['fa', 'en', 'auto'] as const;

/** Edit by text: the clips' words; select and delete to cut, or remove pauses and filler words. */
export function TranscriptPanel({ project }: { project: Project }) {
  const { t } = useTranslation();
  const stt = useStt();
  const selection = useTimelineUi((s) => s.selection);
  const [lang, setLang] = useState<(typeof LANGS)[number]>('fa');
  const [minSilence, setMinSilence] = useState(0.6);
  const [fillers, setFillers] = useState(true);
  const [optional, setOptional] = useState(false);
  const [review, setReview] = useState<Removal[] | null>(null);
  const [unchecked, setUnchecked] = useState<Set<string>>(new Set());
  const box = useRef<HTMLDivElement>(null);
  const clips = useMemo(() => transcriptClips(project), [project]);
  const busy = stt.target === 'transcript' && (stt.stage === 'extracting' || stt.stage === 'loading' || stt.stage === 'transcribing');
  const audible = selection.filter((id) => project.tracks.some((tr) => tr.kind !== 'text' && tr.clips.some((c) => c.id === id && c.assetId)));
  // The most accurate installed model; on a phone the most accurate one that fits (see isPhone).
  const fits = [...WHISPER_SIZES].reverse().filter((s) => !isPhone() || !heavyModel(s));
  const model: WhisperSize = fits.find((s) => stt.models[s]) ?? fits[0];

  useEffect(() => void checkModels(), []);

  // Light up the word being spoken, without re-rendering the whole text every frame.
  useEffect(() => {
    let lit: Element | null = null;
    return useTransport.subscribe((s) => {
      const spans = box.current?.querySelectorAll<HTMLElement>('[data-word]');
      if (!spans) return;
      let found: Element | null = null;
      for (const el of spans) if (Number(el.dataset.t0) <= s.time && s.time < Number(el.dataset.t1)) found = el;
      if (found === lit) return;
      lit?.classList.remove('bg-accent/40');
      found?.classList.add('bg-accent/40');
      lit = found;
    });
  }, []);

  /** The selected words → time ranges to cut (one per clip). */
  const selectedRanges = (): [number, number][] => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !box.current) return [];
    const range = sel.getRangeAt(0);
    const out: [number, number][] = [];
    clips.forEach((tc, ci) => {
      const hit = tc.words.map((_, wi) => box.current!.querySelector(`[data-word="${ci}:${wi}"]`)).map((el, wi) => (el && range.intersectsNode(el) ? wi : -1)).filter((i) => i >= 0);
      if (hit.length) out.push(wordsRange(tc, hit[0], hit[hit.length - 1]));
    });
    return out;
  };
  const cutSelection = () => {
    const ranges = selectedRanges();
    if (ranges.length && cutRanges(ranges)) window.getSelection()?.removeAllRanges();
  };
  const found = review ?? [];
  const startReview = () => {
    setUnchecked(new Set());
    setReview(removals(project, { minSilence, fillers, optionalFillers: optional }));
  };

  return (
    <div className="flex h-full flex-col text-xs" data-testid="transcript-panel">
      <div className="space-y-2 border-b border-line p-2">
        <div className="flex items-center gap-2">
          <select className="rounded bg-surface-3 px-1 py-1" value={lang} disabled={busy} aria-label={t('stt.language')} onChange={(e) => setLang(e.target.value as typeof lang)}>
            {LANGS.map((l) => (
              <option key={l} value={l}>
                {l === 'auto' ? t('stt.autoDetect') : t(`subtitles.languages.${l}`)}
              </option>
            ))}
          </select>
          {busy ? (
            <>
              <span className="flex-1 text-neutral-300" data-testid="transcript-progress">
                {t(`stt.stage.${stt.stage}`)} {Math.round(stt.progress * 100)}%
              </span>
              <Button className="text-xs" onClick={cancelAutoSubtitles}>
                {t('stt.cancel')}
              </Button>
            </>
          ) : (
            <Button className="flex-1 text-xs" disabled={!audible.length} data-testid="transcribe" onClick={() => void transcribeClips(audible, { model, language: lang === 'auto' ? null : lang })}>
              📝 {t('transcript.transcribe', { count: audible.length })}
            </Button>
          )}
        </div>
        {!audible.length && !clips.length && <p className="text-neutral-400">{t('transcript.intro')}</p>}
        {stt.target === 'transcript' && stt.stage === 'error' && (
          <p className="text-red-300">
            {t(`stt.errors.${stt.error}`)}
            {stt.detail && <span className="block text-[10px] text-neutral-400" dir="ltr">{stt.detail}</span>}
          </p>
        )}
      </div>

      {clips.length > 0 && (
        <div className="space-y-2 border-b border-line p-2">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1">
              {t('transcript.pauses')}
              <input type="number" min={0.2} max={5} step={0.1} value={minSilence} className="w-14 rounded bg-surface-3 px-1" aria-label={t('transcript.pauses')} onChange={(e) => setMinSilence(Math.max(0.2, Number(e.target.value) || 0.6))} />
              s
            </label>
            <label className="flex items-center gap-1">
              <input type="checkbox" checked={fillers} onChange={(e) => setFillers(e.target.checked)} />
              {t('transcript.fillers')}
            </label>
            <label className="flex items-center gap-1" title={t('transcript.optionalHint')}>
              <input type="checkbox" checked={optional} disabled={!fillers} onChange={(e) => setOptional(e.target.checked)} />
              {t('transcript.optional')}
            </label>
          </div>
          <div className="flex gap-1">
            <Button className="text-xs" data-testid="find-removals" onClick={startReview}>
              🔍 {t('transcript.find')}
            </Button>
            <Button className="text-xs" data-testid="cut-words" onMouseDown={(e) => e.preventDefault()} onClick={cutSelection} title={t('transcript.cutHint')}>
              ✂ {t('transcript.cut')} <ProBadge />
            </Button>
          </div>
          {review && (
            <div className="space-y-1 rounded border border-line p-1.5" data-testid="removal-review">
              {found.length === 0 ? (
                <p className="text-neutral-400">{t('transcript.nothing')}</p>
              ) : (
                <>
                  <div className="max-h-40 space-y-0.5 overflow-auto">
                    {found.map((r) => (
                      <label key={r.id} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!unchecked.has(r.id)}
                          onChange={(e) =>
                            setUnchecked((s) => {
                              const n = new Set(s);
                              if (e.target.checked) n.delete(r.id);
                              else n.add(r.id);
                              return n;
                            })
                          }
                        />
                        <span className="font-mono text-neutral-400" dir="ltr">
                          {formatDuration(Math.floor(r.range[0]))}
                        </span>
                        <span>{r.kind === 'silence' ? t('transcript.pause', { s: (r.range[1] - r.range[0]).toFixed(1) }) : `«${r.text}»`}</span>
                      </label>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      className="bg-accent/70! text-xs"
                      data-testid="remove-all"
                      onClick={() => {
                        if (cutRanges(found.filter((r) => !unchecked.has(r.id)).map((r) => r.range), 'ops.removePauses')) setReview(null);
                      }}
                    >
                      {t('transcript.remove', { count: found.length - unchecked.size })} <ProBadge />
                    </Button>
                    <Button className="text-xs" onClick={() => setReview(null)}>
                      {t('transcript.close')}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      )}

      <div
        ref={box}
        tabIndex={0}
        className="min-h-0 flex-1 space-y-3 overflow-auto p-2 text-sm leading-7 outline-none select-text"
        data-testid="transcript-text"
        onKeyDown={(e) => {
          if (e.key !== 'Delete' && e.key !== 'Backspace') return;
          e.preventDefault();
          e.stopPropagation();
          cutSelection();
        }}
      >
        {clips.map((tc, ci) => (
          <p key={tc.clip.id} dir={tc.clip.transcript!.rtl ? 'rtl' : 'ltr'} data-testid="transcript-clip">
            {tc.words.map((w, wi) => {
              const pause = wi > 0 && w.start - tc.words[wi - 1].end >= minSilence;
              const filler = fillers && isFiller(w.text, tc.clip.transcript!.language, optional);
              return (
                <span key={wi}>
                  {pause && <span className="mx-0.5 rounded bg-sky-900/60 px-1 text-[10px] text-sky-200 select-none">⏸ {(w.start - tc.words[wi - 1].end).toFixed(1)}s</span>}
                  <span
                    data-word={`${ci}:${wi}`}
                    data-t0={w.start}
                    data-t1={w.end}
                    className={`cursor-pointer rounded px-0.5 hover:bg-surface-3 ${filler ? 'text-amber-300 underline decoration-dotted' : ''}`}
                    onClick={() => window.getSelection()?.isCollapsed !== false && useTransport.getState().seek(w.start)}
                  >
                    {w.text}
                  </span>{' '}
                </span>
              );
            })}
          </p>
        ))}
      </div>
    </div>
  );
}
