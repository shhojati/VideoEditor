import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { parseTimecode } from '../../lib/time';
import { useTransport } from '../../store/transport';

/**
 * The playhead time; click it to type a time (seconds, m:ss, h:mm:ss or hh:mm:ss:ff), Enter jumps
 * there, Esc cancels.
 */
export function TimecodeField({ format, fps, testId, className = '' }: { format: (t: number) => string; fps: number; testId: string; className?: string }) {
  const { t } = useTranslation();
  const time = useTransport((s) => s.time);
  const [draft, setDraft] = useState<string | null>(null);

  const commit = () => {
    if (draft === null) return;
    const v = parseTimecode(draft, fps);
    setDraft(null);
    if (v === null) return;
    const { duration, seek } = useTransport.getState();
    seek(Math.min(Math.max(0, v), Math.max(0, duration)));
  };

  if (draft !== null)
    return (
      <input
        autoFocus
        dir="ltr"
        value={draft}
        data-testid={`${testId}-input`}
        aria-label={t('transport.goTo')}
        className={`w-28 rounded bg-surface-3 px-1 font-mono text-neutral-100 outline-none ring-1 ring-accent ${className}`}
        onFocus={(e) => e.currentTarget.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          else if (e.key === 'Escape') setDraft(null);
          // Keys typed here are not shortcuts.
          e.stopPropagation();
        }}
      />
    );
  return (
    <button
      type="button"
      dir="ltr"
      data-testid={testId}
      title={t('transport.goTo')}
      className={`cursor-text rounded px-1 font-mono hover:bg-surface-3 ${className}`}
      onClick={() => setDraft(format(time))}
    >
      {format(time)}
    </button>
  );
}
