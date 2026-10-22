import { useTranslation } from 'react-i18next';
import { keyToTimeline } from '../../model/remap';
import type { Clip, PaintStroke, Project } from '../../model/types';
import { useTransport } from '../../store/transport';
import { Section, Segmented } from '../inspector/controls';
import { useTool } from '../tools/toolService';
import { clearPaint, deleteStroke, setFrameByFrame, setStroke, stepDrawing } from './paintService';

const ICON: Record<PaintStroke['tool'], string> = { brush: '🖌', eraser: '⌫', clone: '⧉' };
const btn = 'rounded bg-surface-3 px-2 py-1 text-xs hover:bg-[#363c49] disabled:opacity-40';
const input = 'w-12 rounded bg-surface-3 px-1 py-0.5 text-end';

type DurationKind = 'constant' | 'frame' | 'custom';

/** The clip's brush strokes, newest first: when each shows, Write On, delete; clear them all. */
export function PaintSection({ project, clip }: { project: Project; clip: Clip }) {
  const { t } = useTranslation();
  const strokes = clip.paint?.strokes ?? [];
  const fps = project.settings.fps;
  const frames = clip.paint?.frames;
  const onion = useTool((s) => s.onion);
  const kindOf = (s: PaintStroke): DurationKind => (s.duration === undefined ? 'constant' : Math.abs(s.duration - 1 / fps) < 1e-4 ? 'frame' : 'custom');
  return (
    <Section id="paint" title={t('paint.title')}>
      <label className="flex items-center gap-2 text-xs text-neutral-300" title={t('paint.framesHint')}>
        <input type="checkbox" checked={!!frames} onChange={(e) => setFrameByFrame(clip.id, e.target.checked ? 2 : null)} data-testid="frame-by-frame" />
        {t('paint.frameByFrame')}
      </label>
      {frames && (
        <div className="space-y-1.5 rounded border border-line/60 p-1.5">
          <Segmented
            label={t('paint.hold')}
            value={frames.hold}
            options={[1, 2, 3].map((n) => ({ value: n, label: t('paint.holdN', { count: n }) }))}
            onChange={(n) => setFrameByFrame(clip.id, n)}
          />
          <div className="flex items-center gap-1">
            <button className={btn} onClick={() => stepDrawing(clip.id, -1)} title={`${t('paint.prevDrawing')} (,)`} data-testid="prev-drawing">
              ◀ {t('paint.drawing')}
            </button>
            <button className={btn} onClick={() => stepDrawing(clip.id, 1)} title={`${t('paint.nextDrawing')} (.)`} data-testid="next-drawing">
              {t('paint.drawing')} ▶
            </button>
          </div>
          <label className="flex items-center gap-2 text-xs text-neutral-300">
            <input type="checkbox" checked={onion} onChange={(e) => useTool.setState({ onion: e.target.checked })} />
            {t('paint.onion')}
          </label>
        </div>
      )}
      <p className="text-[11px] text-neutral-400">{t('paint.count', { count: strokes.length })}</p>
      <ul className="max-h-60 space-y-1 overflow-y-auto" data-testid="stroke-list">
        {[...strokes].reverse().map((s, i) => {
          const kind = kindOf(s);
          const at = keyToTimeline(clip, s.start);
          return (
            <li key={s.id} className="flex flex-wrap items-center gap-1.5 rounded bg-surface-2 px-1.5 py-1 text-xs" data-testid="stroke-row">
              <span aria-hidden>{ICON[s.tool]}</span>
              {s.tool === 'brush' && <span className="h-3 w-3 rounded-full border border-white/30" style={{ background: s.color }} aria-hidden />}
              <button className="text-sky-300 hover:underline" title={t('paint.goTo')} onClick={() => useTransport.getState().seek(at)} dir="ltr">
                #{strokes.length - i} · {at.toFixed(2)}s
              </button>
              <select
                aria-label={t('paint.duration')}
                className="rounded bg-surface-3 px-1 py-0.5"
                value={kind}
                onChange={(e) => {
                  const k = e.target.value as DurationKind;
                  setStroke(clip.id, s.id, { duration: k === 'constant' ? undefined : k === 'frame' ? 1 / fps : Math.max(1 / fps, s.duration ?? 1) });
                }}
              >
                {(['constant', 'frame', 'custom'] as const).map((k) => (
                  <option key={k} value={k}>
                    {t(`paint.durations.${k}`)}
                  </option>
                ))}
              </select>
              {kind === 'custom' && (
                <input
                  className={input}
                  dir="ltr"
                  type="number"
                  min={0.05}
                  step={0.1}
                  aria-label={t('paint.seconds')}
                  value={Math.round((s.duration ?? 1) * 100) / 100}
                  onChange={(e) => Number(e.target.value) > 0 && setStroke(clip.id, s.id, { duration: Number(e.target.value) })}
                />
              )}
              {s.tool === 'brush' && (
                <label className="flex items-center gap-1 text-neutral-400" title={t('paint.writeOnHint')}>
                  ✍
                  <input
                    className={input}
                    dir="ltr"
                    type="number"
                    min={0}
                    step={0.1}
                    aria-label={t('paint.writeOn')}
                    value={s.writeOn ?? 0}
                    onChange={(e) => setStroke(clip.id, s.id, { writeOn: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })}
                  />
                </label>
              )}
              <button className="ms-auto text-neutral-400 hover:text-red-400" aria-label={t('paint.deleteStroke')} title={t('paint.deleteStroke')} onClick={() => deleteStroke(clip.id, s.id)}>
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      <button className={btn} disabled={!strokes.length} onClick={() => clearPaint(clip.id)} data-testid="clear-paint">
        {t('paint.clear')}
      </button>
    </Section>
  );
}
