import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../app/ui';
import { estimateBytes, outputSize, type ExportSettings } from '../../engine/export/settings';
import { formatBytes, formatDuration } from '../../lib/time';
import { timelineDuration } from '../../model/timeline';
import type { Project } from '../../model/types';
import { Segmented } from '../inspector/controls';
import { cancelExport, closeExportDialog, startExport, useExport } from './exportService';

const FPS = [24, 25, 30, 50, 60] as const;

export function ExportDialog({ project }: { project: Project }) {
  const { t } = useTranslation();
  const state = useExport();
  const nearest = FPS.reduce((a, b) => (Math.abs(b - project.settings.fps) < Math.abs(a - project.settings.fps) ? b : a));
  const [settings, setSettings] = useState<ExportSettings>({
    resolution: 1080,
    fps: nearest,
    quality: 'medium',
    burnSubtitles: true,
    srt: false,
  });
  if (!state.open) return null;
  const set = (patch: Partial<ExportSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const duration = timelineDuration(project);
  const size = outputSize(project.settings, settings.resolution);
  const running = state.stage === 'audio' || state.stage === 'video';
  const hasSubtitles = project.subtitleTracks.some((s) => !s.hidden && s.cues.length);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <div className="w-[min(440px,94vw)] space-y-3 rounded-lg border border-line bg-surface-1 p-4 text-sm shadow-2xl" data-testid="export-dialog">
        <h2 id="export-title" className="text-base font-semibold text-white">
          {t('export.title')}
        </h2>

        {!running && state.stage !== 'done' && (
          <>
            <Segmented label={t('export.resolution')} value={settings.resolution} options={[720, 1080].map((r) => ({ value: r as 720 | 1080, label: `${r}p` }))} onChange={(v) => set({ resolution: v })} />
            <Segmented label={t('export.fps')} value={settings.fps} options={FPS.map((f) => ({ value: f, label: String(f) }))} onChange={(v) => set({ fps: v })} />
            <Segmented label={t('export.quality')} value={settings.quality} options={(['low', 'medium', 'high'] as const).map((q) => ({ value: q, label: t(`export.qualities.${q}`) }))} onChange={(v) => set({ quality: v })} />
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={settings.burnSubtitles} disabled={!hasSubtitles} onChange={(e) => set({ burnSubtitles: e.target.checked })} />
              {t('export.burnSubtitles')}
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={settings.srt} disabled={!hasSubtitles} onChange={(e) => set({ srt: e.target.checked })} />
              {t('export.alsoSrt')}
            </label>
            <p className="text-xs text-neutral-400" dir="auto">
              {t('export.summary', {
                size: `${size.width}×${size.height}`,
                duration: formatDuration(duration),
                bytes: formatBytes(estimateBytes(duration, size.width, size.height, settings.fps, settings.quality)),
              })}
            </p>
          </>
        )}

        {running && (
          <div className="space-y-2" data-testid="export-progress">
            <div className="text-xs text-neutral-300">
              {t(`export.stage.${state.stage}`)} {Math.round(state.progress * 100)}%
              {state.eta !== undefined && ` · ${t('export.eta', { time: formatDuration(state.eta) })}`}
            </div>
            <div className="h-2 rounded bg-surface-3">
              <div className="h-2 rounded bg-accent transition-[width]" style={{ width: `${Math.round(state.progress * 100)}%` }} />
            </div>
          </div>
        )}

        {state.stage === 'done' && state.result && (
          <div className="space-y-2 text-xs" data-testid="export-done">
            <p className="text-emerald-300">
              {t('export.done', {
                name: state.result.name,
                bytes: formatBytes(state.result.bytes),
                seconds: state.result.seconds.toFixed(1),
                ratio: (state.result.seconds / Math.max(0.01, duration)).toFixed(2),
              })}
            </p>
            {state.result.audioCodec === 'opus' && <p className="text-amber-300">{t('export.opusWarning')}</p>}
            {state.result.url && (
              <a className="inline-block rounded bg-accent px-3 py-1.5 text-white" href={state.result.url} download={state.result.name} data-testid="export-download">
                {t('export.download')}
              </a>
            )}
          </div>
        )}
        {state.stage === 'error' && <p className="text-xs text-red-300" role="alert">{t('export.error', { message: state.error })}</p>}
        {state.stage === 'cancelled' && <p className="text-xs text-neutral-400">{t('export.cancelled')}</p>}

        <div className="flex justify-end gap-2 pt-1">
          {running ? (
            <Button onClick={cancelExport}>{t('export.cancel')}</Button>
          ) : (
            <>
              <Button onClick={closeExportDialog}>{t('export.close')}</Button>
              {state.stage !== 'done' && (
                <Button className="bg-accent! text-white" disabled={duration <= 0} onClick={() => void startExport(project, settings)} data-testid="export-start">
                  {t('export.start')}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
