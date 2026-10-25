import { useTranslation } from 'react-i18next';
import { findClip } from '../../model/timeline';
import { useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { openRecorder } from '../record/recordService';
import { useScopes } from './Scopes';
import { jumpToEdit, stepFrames } from '../timeline/actions';
import { useTimelineUi } from '../timeline/timelineUi';
import { stepZoom, usePreviewView, ZOOM_PRESETS, zoomTo, zoomToFit } from './previewView';
import { toggleFullscreen, useFullscreen } from './fullscreen';
import { TimecodeField } from './TimecodeField';
import { BarChart3, ChevronLeft, ChevronRight, Maximize, Mic, Minimize, Minus, Pause, Play, Plus, Repeat, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { Icon } from '../../app/icons';

/** HH:MM:SS:FF at the project frame rate. */
export function formatTimecode(t: number, fps: number) {
  const frames = Math.round(t * fps);
  const f = frames % Math.round(fps);
  const s = Math.floor(frames / Math.round(fps));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}:${pad(f)}`;
}

const iconBtn = 'flex h-7 min-w-7 items-center justify-center rounded-md px-1.5 text-sm text-neutral-200 hover:bg-surface-3 disabled:opacity-40 md:h-9 md:min-w-9';

/** −, a zoom level picker (Fit + presets; shows the current level) and +. */
function ZoomControls() {
  const { t } = useTranslation();
  const k = usePreviewView((s) => s.view.k);
  const mode = usePreviewView((s) => s.mode);
  const pct = `${Math.round(k * 100)}%`;
  const isPreset = ZOOM_PRESETS.some((p) => Math.abs(p - k) < 1e-6);
  return (
    <div className="flex items-center gap-0.5">
      <button className={iconBtn} onClick={() => zoomTo(stepZoom(k, -1))} aria-label={t('preview.zoomOut')} title={`${t('preview.zoomOut')} (wheel)`}>
        <Icon icon={Minus} size={16} />
      </button>
      <select
        className="rounded-md border border-line bg-surface-2 px-1.5 py-0.5 text-xs text-neutral-200 md:h-8 md:px-2 md:text-sm"
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
      <button className={iconBtn} onClick={() => zoomTo(stepZoom(k, 1))} aria-label={t('preview.zoomIn')} title={`${t('preview.zoomIn')} (wheel)`}>
        <Icon icon={Plus} size={16} />
      </button>
    </div>
  );
}

export function TransportBar({ fps }: { fps: number }) {
  const { t } = useTranslation();
  const playing = useTransport((s) => s.playing);
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
    <div className="flex flex-wrap items-center gap-1 border-t border-line bg-surface-1 px-2 py-1 text-xs md:gap-1.5 md:px-3 md:py-2 md:text-sm max-md:flex-nowrap max-md:overflow-x-auto max-md:[scrollbar-width:none] max-md:*:shrink-0">
      <button className={iconBtn} onClick={() => jumpToEdit(-1)} title={t('transport.prevEdit')} aria-label={t('transport.prevEdit')}>
        <Icon icon={SkipBack} />
      </button>
      <button className={iconBtn} onClick={() => stepFrames(-1)} title={t('transport.prevFrame')} aria-label={t('transport.prevFrame')}>
        <Icon icon={ChevronLeft} />
      </button>
      <button
        className={`${iconBtn} w-9 bg-surface-3 md:w-11`}
        onClick={toggle}
        disabled={duration <= 0}
        data-testid="play"
        data-state={playing ? 'playing' : 'paused'}
        aria-label={playing ? t('transport.pause') : t('transport.play')}
        title={`${playing ? t('transport.pause') : t('transport.play')} (Space)`}
      >
        <Icon icon={playing ? Pause : Play} className="fill-current" />
      </button>
      <button className={iconBtn} onClick={() => stepFrames(1)} title={t('transport.nextFrame')} aria-label={t('transport.nextFrame')}>
        <Icon icon={ChevronRight} />
      </button>
      <button className={iconBtn} onClick={() => jumpToEdit(1)} title={t('transport.nextEdit')} aria-label={t('transport.nextEdit')}>
        <Icon icon={SkipForward} />
      </button>
      <span className="mx-2 flex items-center font-mono text-neutral-200 tabular-nums max-md:mx-1 md:mx-3">
        <TimecodeField format={(x) => formatTimecode(x, fps)} fps={fps} testId="preview-timecode" />
        <span className="text-muted">&nbsp;/&nbsp;{formatTimecode(duration, fps)}</span>
      </span>
      <button
        className={`${iconBtn} ${loop ? 'bg-accent-soft text-accent' : ''}`}
        aria-pressed={loop}
        onClick={() => useTransport.setState({ loop: !loop })}
        title={t('transport.loop')}
        aria-label={t('transport.loop')}
      >
        <Icon icon={Repeat} />
      </button>
      <button className={`${iconBtn} text-red-400`} onClick={openRecorder} title={t('record.open')} aria-label={t('record.open')} data-testid="record-open">
        <Icon icon={Mic} />
      </button>
      {/* Phones use the hardware volume keys. */}
      <label className="flex items-center gap-1 max-md:hidden" title={t('transport.volume')}>
        <Icon icon={Volume2} className="text-neutral-300" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={volume}
          aria-label={t('transport.volume')}
          className="w-20 accent-accent md:w-32"
          onChange={(e) => useTransport.setState({ volume: Number(e.target.value) })}
        />
      </label>
      <div className="ms-auto flex gap-1">
        <ScopesButton />
        <ZoomControls />
        <FullscreenButton />
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

function FullscreenButton() {
  const { t } = useTranslation();
  const on = useFullscreen();
  const label = `${t(on ? 'preview.exitFullscreen' : 'preview.fullscreen')} (~)`;
  return (
    <button className={iconBtn} aria-pressed={on} onClick={toggleFullscreen} title={label} aria-label={label} data-testid="preview-fullscreen">
      <Icon icon={on ? Minimize : Maximize} />
    </button>
  );
}

function ScopesButton() {
  const { t } = useTranslation();
  const open = useScopes((s) => s.open);
  return (
    <button className={`${iconBtn} ${open ? 'bg-accent-soft text-accent' : ''}`} aria-pressed={open} onClick={() => useScopes.setState({ open: !open })} title={t('scopes.toggle')} aria-label={t('scopes.toggle')} data-testid="scopes-toggle">
      <Icon icon={BarChart3} />
    </button>
  );
}
