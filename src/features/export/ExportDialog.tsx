import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../app/ui';
import {
  AUDIO_BITRATE,
  AUDIO_BITRATES,
  EXPORT_FORMATS,
  FORMATS,
  PCM_BITRATE,
  effectiveAudioBitrate,
  effectiveVideoBitrate,
  estimateBytes,
  fitToFormat,
  hasAudio,
  outputSize,
  type ExportSettings,
} from '../../engine/export/settings';
import { formatBytes, formatDuration } from '../../lib/time';
import { overLimitBy } from '../../model/platforms';
import { timelineDuration } from '../../model/timeline';
import { soloActive } from '../../model/visibility';
import { lengthWarningText } from '../projects/LengthWarning';
import type { Project } from '../../model/types';
import { friendlyError } from '../../app/toasts';
import { useTransport } from '../../store/transport';
import { Segmented, SelectField } from '../inspector/controls';
import { cancelExport, closeExportDialog, startExport, useExport } from './exportService';
import { loadAccount, refreshAccount, useAccount } from '../../store/account';
import { openAccount, openAuth, usePricing } from '../account/AccountDialogs';
import { exportPolicy, type ExportPolicy } from '../account/policy';

const kbps = (bps: number) => Math.round(bps / 1000);
// Left-to-right isolate: keeps "7465 kbps" in order inside a Persian sentence.
const [LRI, PDI] = [String.fromCharCode(0x2066), String.fromCharCode(0x2069)];
/** m:ss.t — a frame needs more precision than whole seconds. */
const frameClock = (t: number) => `${formatDuration(Math.floor(t))}.${Math.floor((t % 1) * 10)}`;

export function ExportDialog({ project }: { project: Project }) {
  const { t, i18n } = useTranslation();
  const rate = (bps: number) =>
    i18n.dir() === 'rtl' ? `${LRI}${kbps(bps)} kbps${PDI}` : `${kbps(bps)} kbps`;
  const state = useExport();
  const playhead = useTransport((s) => s.time);
  const [settings, setSettings] = useState<ExportSettings>(() =>
    fitToFormat({
      format: 'mp4',
      resolution: 1080,
      fps: project.settings.fps as ExportSettings['fps'],
      quality: 'medium',
      videoBitrate: 8_000_000,
      audioBitrate: AUDIO_BITRATE,
      imageMode: 'frame',
      frameTime: 0,
      burnSubtitles: true,
      srt: false,
    }),
  );
  const me = useAccount((s) => s.me);
  const accountStatus = useAccount((s) => s.status);
  const pricing = usePricing();
  // Pick up a Pro activation made while the page was open.
  useEffect(() => {
    if (state.open) refreshAccount(true);
  }, [state.open]);
  if (!state.open) return null;
  const set = (patch: Partial<ExportSettings>) => setSettings((s) => fitToFormat({ ...s, ...patch }));
  const format = FORMATS[settings.format];
  const duration = timelineDuration(project);
  const size = outputSize(project.settings, settings.resolution);
  const running = state.stage === 'audio' || state.stage === 'video' || state.stage === 'encode';
  const tooLong = overLimitBy(project) > 0;
  const hasSubtitles = project.subtitleTracks.some((s) => !s.hidden && s.cues.length);
  // The eye and solo apply to the export too: say so before it runs.
  const hiddenTracks = project.tracks.filter((x) => x.hidden && x.clips.length).length;
  const solo = soloActive(project);
  const isVideo = format.kind === 'video';
  const singleFrame = format.kind === 'image' && settings.imageMode === 'frame';
  const frameTime = Math.min(playhead, duration);
  const policy = exportPolicy(me, pricing?.freeMaxSeconds ?? 60, singleFrame ? 0 : duration);
  const offline = policy.kind === 'login' && accountStatus === 'offline';
  const videoBps = effectiveVideoBitrate(settings, size.width, size.height);
  const audioBps = effectiveAudioBitrate(settings);
  const bytes = estimateBytes(settings, duration, size.width, size.height);
  const stageLabel =
    state.stage === 'video' && !isVideo ? t('export.stage.frames') : t(`export.stage.${state.stage}`);
  const result = state.result;
  const resultBitrate =
    result &&
    (FORMATS[result.settings.format].kind !== 'image' ? (result.bytes * 8) / Math.max(0.01, duration) : 0);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="export-title"
    >
      <div
        className="max-h-[94vh] w-[min(440px,94vw)] space-y-3 overflow-y-auto rounded-lg border border-line bg-surface-1 p-4 text-sm shadow-2xl"
        data-testid="export-dialog"
      >
        <h2 id="export-title" className="text-base font-semibold text-white">
          {t('export.title')}
        </h2>
        {!running && state.stage !== 'done' && (hiddenTracks > 0 || solo) && (
          <p className="rounded bg-amber-900/40 px-2 py-1.5 text-xs text-amber-200" data-testid="export-hidden-warning">
            {solo ? t('export.soloWarning') : t('export.hiddenWarning', { count: hiddenTracks })}
          </p>
        )}

        {!running && state.stage !== 'done' && (
          <>
            <div data-testid="export-format">
              <SelectField
                label={t('export.format')}
                value={settings.format}
                options={EXPORT_FORMATS.map((f) => ({ value: f, label: t(`export.formats.${f}`) }))}
                onChange={(v) => set({ format: v })}
              />
            </div>
            {format.kind === 'image' && (
              <Segmented
                label={t('export.imageMode')}
                value={settings.imageMode}
                options={[
                  {
                    value: 'frame' as const,
                    label: t('export.imageModes.frame', { time: frameClock(frameTime) }),
                  },
                  { value: 'sequence' as const, label: t('export.imageModes.sequence') },
                ]}
                onChange={(v) => set({ imageMode: v })}
              />
            )}
            {format.resolutions.length > 0 && (
              <Segmented
                label={t('export.resolution')}
                value={settings.resolution}
                options={format.resolutions.map((r) => ({ value: r, label: `${r}p` }))}
                onChange={(v) => set({ resolution: v })}
              />
            )}
            {format.fps.length > 0 && !singleFrame && (
              <Segmented
                label={t('export.fps')}
                value={settings.fps}
                options={format.fps.map((f) => ({ value: f, label: String(f) }))}
                onChange={(v) => set({ fps: v })}
              />
            )}
            {isVideo && (
              <>
                <Segmented
                  label={t('export.quality')}
                  value={settings.quality}
                  options={(['low', 'medium', 'high', 'custom'] as const).map((q) => ({
                    value: q,
                    label: t(`export.qualities.${q}`),
                  }))}
                  // "Custom" starts from the bitrate shown now.
                  onChange={(v) => set({ quality: v, videoBitrate: videoBps })}
                />
                <label className="flex flex-col gap-1 text-xs">
                  <span className="text-neutral-400">{t('export.videoBitrate')}</span>
                  <BitrateInput
                    value={kbps(videoBps)}
                    onCommit={(k) => set({ quality: 'custom', videoBitrate: k * 1000 })}
                  />
                </label>
              </>
            )}
            {hasAudio(settings) &&
              (settings.format === 'avi' ? (
                <p className="text-xs text-neutral-400">
                  {t('export.pcmAudio', { kbps: rate(PCM_BITRATE) })}
                </p>
              ) : (
                <SelectField
                  label={t('export.audioBitrate')}
                  value={settings.audioBitrate}
                  options={AUDIO_BITRATES.map((b) => ({ value: b as number, label: rate(b) }))}
                  onChange={(v) => set({ audioBitrate: v })}
                />
              ))}
            {settings.format === 'gif' && <p className="text-xs text-neutral-400">{t('export.gifNote')}</p>}
            {format.kind !== 'audio' && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={settings.burnSubtitles}
                  disabled={!hasSubtitles}
                  onChange={(e) => set({ burnSubtitles: e.target.checked })}
                />
                {t('export.burnSubtitles')}
              </label>
            )}
            {isVideo && (
              <label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={settings.srt}
                  disabled={!hasSubtitles}
                  onChange={(e) => set({ srt: e.target.checked })}
                />
                {t('export.alsoSrt')}
              </label>
            )}
            <p className="text-xs text-neutral-400" dir="auto">
              {singleFrame
                ? t('export.frameSummary', {
                    size: `${size.width}×${size.height}`,
                    time: frameClock(frameTime),
                    bytes: formatBytes(bytes),
                  })
                : t('export.summary', {
                    size: format.kind === 'audio' ? 'MP3' : `${size.width}×${size.height}`,
                    duration: formatDuration(duration),
                    bytes: formatBytes(bytes),
                  })}
            </p>
            {(isVideo || format.kind === 'audio') && (
              <p className="text-xs text-neutral-400" dir="auto" data-testid="export-bitrate">
                {t('export.bitrateSummary', {
                  video: rate(isVideo ? videoBps : 0),
                  audio: rate(audioBps),
                  total: rate((isVideo ? videoBps : 0) + audioBps),
                })}
              </p>
            )}
            {tooLong && (
              <p
                className="rounded border border-amber-700 bg-amber-900/40 p-2 text-xs text-amber-200"
                role="alert"
                data-testid="export-length-warning"
              >
                {lengthWarningText(project, t)} {t('length.exportHint')}
              </p>
            )}
            <ExportGate policy={policy} offline={offline} duration={duration} />
          </>
        )}

        {running && (
          <div className="space-y-2" data-testid="export-progress">
            <div className="text-xs text-neutral-300">
              {stageLabel} {Math.round(state.progress * 100)}%
              {state.eta !== undefined && ` · ${t('export.eta', { time: formatDuration(state.eta) })}`}
            </div>
            <div className="h-2 rounded bg-surface-3">
              <div
                className="h-2 rounded bg-accent transition-[width]"
                style={{ width: `${Math.round(state.progress * 100)}%` }}
              />
            </div>
          </div>
        )}

        {state.stage === 'done' && result && (
          <div className="space-y-2 text-xs" data-testid="export-done">
            <p className="text-emerald-300">
              {t('export.done', {
                name: result.name,
                bytes: formatBytes(result.bytes),
                seconds: result.seconds.toFixed(1),
                ratio: (result.seconds / Math.max(0.01, duration)).toFixed(2),
              })}
              {resultBitrate ? ` ${t('export.averageBitrate', { kbps: rate(resultBitrate) })}` : ''}
            </p>
            {result.audioCodec === 'opus' && result.settings.format !== 'webm' && (
              <p className="text-amber-300">{t('export.opusWarning')}</p>
            )}
            {result.aacSource === 'wasm' && (
              <p className="text-neutral-400" data-testid="software-aac">
                {t('export.softwareAac')}
              </p>
            )}
            {result.url && (
              <a
                className="inline-block rounded bg-accent px-3 py-1.5 text-white"
                href={result.url}
                download={result.name}
                data-testid="export-download"
              >
                {t('export.download')}
              </a>
            )}
          </div>
        )}
        {state.stage === 'error' && (
          <p className="text-xs text-red-300" role="alert">
            {t('export.error', { message: friendlyError(state.error, t) })}
          </p>
        )}
        {state.stage === 'cancelled' && <p className="text-xs text-neutral-400">{t('export.cancelled')}</p>}

        <div className="flex justify-end gap-2 pt-1">
          {running ? (
            <Button onClick={cancelExport}>{t('export.cancel')}</Button>
          ) : (
            <>
              <Button onClick={closeExportDialog}>{t('export.close')}</Button>
              {state.stage !== 'done' &&
                (policy.kind === 'login' && !offline ? (
                  <Button className="bg-accent! text-white" onClick={openAuth} data-testid="export-login">
                    {t('exportGate.loginButton')}
                  </Button>
                ) : (
                  <Button
                    className="bg-accent! text-white"
                    disabled={duration <= 0 || policy.kind !== 'ok'}
                    onClick={() => void startExport(project, { ...settings, frameTime }, policy)}
                    data-testid="export-start"
                  >
                    {tooLong ? t('length.exportAnyway') : t('export.start')}
                  </Button>
                ))}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Plan notes: log in, Free length limit, Free watermark. */
function ExportGate({ policy, offline, duration }: { policy: ExportPolicy; offline: boolean; duration: number }) {
  const { t } = useTranslation();
  if (policy.kind === 'login')
    return offline ? (
      <p className="rounded border border-red-800 bg-red-900/30 p-2 text-xs text-red-200" role="alert" data-testid="export-gate" data-gate="offline">
        {t('exportGate.offline')}{' '}
        <button type="button" className="underline" onClick={() => void loadAccount()}>
          {t('exportGate.retry')}
        </button>
      </p>
    ) : (
      <p className="rounded border border-line bg-surface-2 p-2 text-xs text-neutral-200" data-testid="export-gate" data-gate="login">
        {t('exportGate.login')}
      </p>
    );
  if (policy.kind === 'tooLong')
    return (
      <div className="space-y-2 rounded border border-amber-700 bg-amber-900/40 p-2 text-xs text-amber-100" role="alert" data-testid="export-gate" data-gate="tooLong">
        <p>
          {t('exportGate.tooLong', { max: formatDuration(policy.maxSeconds), duration: formatDuration(duration) })}
        </p>
        <Button className="bg-accent! text-white" onClick={openAccount} data-testid="export-upgrade">
          {t('exportGate.upgrade')}
        </Button>
      </div>
    );
  if (!policy.watermark) return null;
  return (
    <p className="text-xs text-neutral-400" data-testid="export-gate" data-gate="watermark">
      {t('exportGate.watermark')}{' '}
      <button type="button" className="text-accent hover:underline" onClick={openAccount}>
        {t('exportGate.removeWatermark')}
      </button>
    </p>
  );
}

/** kbps box: shows the bitrate in use; a typed value (100–100 000) is committed on blur or Enter. */
function BitrateInput({ value, onCommit }: { value: number; onCommit: (kbps: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    setDraft(null);
    const n = Math.round(Number(raw));
    if (Number.isFinite(n) && n > 0) onCommit(Math.min(100_000, Math.max(100, n)));
  };
  return (
    <input
      dir="ltr"
      inputMode="numeric"
      className="w-28 rounded bg-surface-3 px-2 py-1"
      value={draft ?? String(value)}
      data-testid="export-video-bitrate"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit(e.currentTarget.value);
        if (e.key === 'Escape') setDraft(null);
      }}
    />
  );
}
