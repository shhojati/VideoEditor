import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../app/ui';
import { closeRecorder, setRecordOptions, startRecording, stopRecording, useRecord } from './recordService';

/** Voiceover / webcam recorder: device choice, level meter, 3-2-1 countdown, record and stop. */
export function RecordDialog() {
  const { t } = useTranslation();
  const r = useRecord();
  const video = useRef<HTMLVideoElement>(null);
  const hasVideo = !!r.stream?.getVideoTracks().length;
  useEffect(() => {
    if (video.current) video.current.srcObject = hasVideo ? r.stream! : null;
  }, [r.stream, hasVideo]);
  if (r.stage === 'closed') return null;
  const busy = r.stage !== 'setup';
  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby="record-title">
      <div className="w-[min(400px,94vw)] space-y-3 rounded-lg border border-line bg-surface-1 p-4 text-sm shadow-2xl" data-testid="record-dialog">
        <h2 id="record-title" className="text-base font-semibold text-white">
          {t('record.title')}
        </h2>

        {r.error && (
          <p className="text-red-300" role="alert">
            {t(`record.errors.${r.error}`)}
          </p>
        )}

        <label className="flex items-center gap-2">
          <span className="w-24 text-neutral-400">{t('record.mic')}</span>
          <select className="min-w-0 flex-1 rounded bg-surface-3 px-1 py-1" value={r.micId ?? ''} disabled={busy} onChange={(e) => setRecordOptions({ micId: e.target.value || undefined })}>
            <option value="">{t('record.defaultDevice')}</option>
            {r.mics.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center gap-2">
          <span className="w-24 text-neutral-400">{t('record.level')}</span>
          <div className="h-2 flex-1 rounded bg-surface-3" data-testid="record-level" data-level={r.level.toFixed(2)}>
            <div className={`h-2 rounded ${r.level > 0.9 ? 'bg-red-500' : 'bg-emerald-500'}`} style={{ width: `${Math.round(r.level * 100)}%` }} />
          </div>
        </div>

        <label className="flex items-center gap-2">
          <input type="checkbox" checked={r.camera} disabled={busy} onChange={(e) => setRecordOptions({ camera: e.target.checked })} />
          <span>{t('record.camera')}</span>
        </label>
        {r.camera && (
          <>
            {r.cams.length > 1 && (
              <label className="flex items-center gap-2">
                <span className="w-24 text-neutral-400">{t('record.cameraDevice')}</span>
                <select className="min-w-0 flex-1 rounded bg-surface-3 px-1 py-1" value={r.camId ?? ''} disabled={busy} onChange={(e) => setRecordOptions({ camId: e.target.value || undefined })}>
                  <option value="">{t('record.defaultDevice')}</option>
                  {r.cams.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {hasVideo && <video ref={video} className="aspect-video w-full rounded bg-black" autoPlay muted playsInline data-testid="record-camera-preview" />}
          </>
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={r.muteTimeline} disabled={busy} onChange={(e) => setRecordOptions({ muteTimeline: e.target.checked })} />
          <span>{t('record.muteTimeline')}</span>
        </label>
        <p className="text-[11px] text-neutral-400">{t('record.hint')}</p>

        {r.stage === 'countdown' && (
          <div className="text-center text-4xl font-bold text-white" data-testid="record-countdown" aria-live="assertive">
            {r.countdown}
          </div>
        )}
        {r.stage === 'recording' && (
          <div className="flex items-center justify-center gap-2 text-lg text-red-400" aria-live="polite">
            <span className="inline-block h-3 w-3 animate-pulse rounded-full bg-red-500" />
            <span className="font-mono">{fmt(r.elapsed)}</span>
          </div>
        )}
        {r.stage === 'saving' && <p className="text-center text-neutral-300">{t('record.saving')}</p>}

        <div className="flex justify-end gap-2">
          {r.stage === 'recording' ? (
            <Button className="bg-red-600! text-white" onClick={stopRecording} data-testid="record-stop">
              ■ {t('record.stop')}
            </Button>
          ) : (
            <>
              <Button onClick={closeRecorder} disabled={busy}>
                {t('record.close')}
              </Button>
              <Button className="bg-red-600/80! text-white" onClick={startRecording} disabled={busy || !r.stream} data-testid="record-start">
                ● {t('record.start')}
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
