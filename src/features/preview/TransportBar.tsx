import { useTranslation } from 'react-i18next';
import { findClip } from '../../model/timeline';
import { useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { openRecorder } from '../record/recordService';
import { jumpToEdit, stepFrames } from '../timeline/actions';
import { useTimelineUi } from '../timeline/timelineUi';
import { stepZoom, usePreviewView, ZOOM_PRESETS, zoomTo, zoomToFit } from './previewView';

/** HH:MM:SS:FF at the project frame rate. */
export function formatTimecode(t: number, fps: number) {
  const frames = Math.round(t * fps);
  const f = frames % Math.round(fps);
  const s = Math.floor(frames / Math.round(fps));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`;
}

const iconBtn = 'rounded px-2 py-1 text-sm text-neutral-200 hover:bg-surface-3 disabled:opacity-40';

/** −, a zoom level picker (Fit + presets; shows the current level) and +. */
function ZoomControls() {
  const { t } = useTranslation();
  const k = usePreviewView((s) => s.view.k);
  const mode = usePreviewView((s) => s.mode);
  const pct = `${Math.round(k * 100)}%`;
  const isPreset = ZOOM_PRESETS.some((p) => Math.abs(p - k) < 1e-6);
  return (
    <div className="flex items-center gap-0.5">
      <button className={iconBtn} onClick={() => zoomTo(stepZoom(k, -1))} aria-label={t('preview.zoomOut')} title={`${t('preview.zoomOut')} (Ctrl+wheel)`}>
        −
      </button>
      <select
        className="rounded bg-surface-2 px-1 py-0.5 text-xs text-neutral-200"
        aria-label={t('preview.zoom')}
        data-testid="preview-zoom"
        value={mode === 'fit' ? 'fit' : isPreset ? String(k) : 'custom'}
        onChange={(e) => (e.target.value === 'fit' ? zoomToFit() : zoomTo(Number(e.target.value)))}
      >
        <option value="fit">
          {t('preview.fit')}
          {mode === 'fit' ? ` (${pct})` : ''}
        </option>
        {!isPreset && mode !== 'fit' && <option value="custom">{pct}</option>}
        {ZOOM_PRESETS.map((p) => (
          <option key={p} value={String(p)}>
            {Math.round(p * 100)}%
          </option>
        ))}
      </select>
      <button className={iconBtn} onClick={() => zoomTo(stepZoom(k, 1))} aria-label={t('preview.zoomIn')} title={`${t('preview.zoomIn')} (Ctrl+wheel)`}>
        +
      </button>
    </div>
  );
}

export function TransportBar({ fps }: { fps: number }) {
  const { t } = useTranslation();
  const playing = useTransport((s) => s.playing);
  const time = useTransport((s) => s.time);
  const duration = useTransport((s) => s.duration);
  const loop = useTransport((s) => s.loop);
  const volume = useTransport((s) => s.volume);
  const { toggle } = useTransport.getState();
  const selection = useTimelineUi((s) => s.selection);

  /** Fit/fill for the selected visual clips (one undo step). */
  const setFit = (fit: 'contain' | 'cover') =>
    useProjectStore.getState().edit('ops.fit', (p) => {
      for (const id of selection) {
        const ref = findClip(p, id);
        if (ref && !ref.track.locked && ref.track.kind === 'video') ref.clip.transform.fit = fit;
      }
    });

  return (
    <div className="flex flex-wrap items-center gap-1 border-t border-line bg-surface-1 px-2 py-1 text-xs max-md:flex-nowrap max-md:overflow-x-auto max-md:[scrollbar-width:none] max-md:*:shrink-0">
      <button className={iconBtn} onClick={() => jumpToEdit(-1)} title={t('transport.prevEdit')} aria-label={t('transport.prevEdit')}>
        ⏮
      </button>
      <button className={iconBtn} onClick={() => stepFrames(-1)} title={t('transport.prevFrame')} aria-label={t('transport.prevFrame')}>
        ◀
      </button>
      <button
        className={`${iconBtn} w-9 bg-surface-3`}
        onClick={toggle}
        disabled={duration <= 0}
        data-testid="play"
        aria-label={playing ? t('transport.pause') : t('transport.play')}
        title={`${playing ? t('transport.pause') : t('transport.play')} (Space)`}
      >
        {playing ? '⏸' : '▶'}
      </button>
      <button className={iconBtn} onClick={() => stepFrames(1)} title={t('transport.nextFrame')} aria-label={t('transport.nextFrame')}>
        ▶
      </button>
      <button className={iconBtn} onClick={() => jumpToEdit(1)} title={t('transport.nextEdit')} aria-label={t('transport.nextEdit')}>
        ⏭
      </button>
      <span className="mx-2 font-mono text-neutral-200 max-md:mx-1" data-testid="preview-timecode">
        {formatTimecode(time, fps)}
        <span className="text-neutral-400"> / {formatTimecode(duration, fps)}</span>
      </span>
      <button
        className={`${iconBtn} ${loop ? 'bg-accent/40' : ''}`}
        aria-pressed={loop}
        onClick={() => useTransport.setState({ loop: !loop })}
        title={t('transport.loop')}
      >
        🔁
      </button>
      <button className={`${iconBtn} text-red-400`} onClick={openRecorder} title={t('record.open')} aria-label={t('record.open')} data-testid="record-open">
        🎙
      </button>
      {/* Phones use the hardware volume keys. */}
      <label className="flex items-center gap-1 max-md:hidden" title={t('transport.volume')}>
        🔊
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          aria-label={t('transport.volume')}
          className="w-20 accent-accent"
          onChange={(e) => useTransport.setState({ volume: Number(e.target.value) })}
        />
      </label>
      <div className="ms-auto flex gap-1">
        <ZoomControls />
        <span className="mx-1 w-px self-stretch bg-line" />
        <button className={iconBtn} disabled={!selection.length} onClick={() => setFit('contain')} title={t('transport.fitHint')}>
          {t('transport.fit')}
        </button>
        <button className={iconBtn} disabled={!selection.length} onClick={() => setFit('cover')} title={t('transport.fillHint')}>
          {t('transport.fill')}
        </button>
      </div>
    </div>
  );
}
