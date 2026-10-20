import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { lintCues } from '../../model/subtitles';
import type { Cue, SubtitleTrack } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { useSubtitlesUi } from '../subtitles/subtitlesUi';
import { beginCueDrag } from './cueInteractions';
import { HEADER_WIDTH, TRACK_HEIGHT, useTimelineUi } from './timelineUi';

/** One subtitle track as a timeline lane of cue blocks (virtualised like clips). */
export const SubtitleLane = memo(function SubtitleLane({
  track,
  view,
  pps,
}: {
  track: SubtitleTrack;
  view: { t0: number; t1: number };
  pps: number;
}) {
  const { t } = useTranslation();
  const edit = useProjectStore((s) => s.edit);
  const selection = useTimelineUi((s) => s.selection);
  const previews = useTimelineUi((s) => s.drag?.cues);
  const dragValid = useTimelineUi((s) => s.drag?.valid ?? true);
  const issues = useMemo(() => lintCues(track.cues), [track.cues]);
  const visible = track.cues.filter((c) => c.start < view.t1 && c.end > view.t0);

  return (
    <div className="flex border-b border-line" style={{ height: TRACK_HEIGHT - 12 }} data-testid="subtitle-lane">
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center gap-2 border-e border-line bg-surface-2 px-2 text-xs"
        style={{ width: HEADER_WIDTH }}
      >
        <span className="h-3 w-1 rounded bg-fuchsia-500" />
        <button
          className="flex-1 truncate text-start hover:underline"
          onClick={() => useSubtitlesUi.setState({ activeTrackId: track.id, tab: 'subtitles' })}
        >
          {t('subtitles.lane', { lang: t(`subtitles.languages.${track.language}`, track.language) })}
        </button>
        <button
          aria-pressed={!track.hidden}
          aria-label={t('subtitles.toggleVisible')}
          title={t('subtitles.toggleVisible')}
          className={`w-6 rounded py-0.5 ${track.hidden ? 'bg-surface-3 text-neutral-500' : 'bg-accent text-white'}`}
          onClick={() =>
            edit('ops.subtitleVisibility', (p) => {
              const st = p.subtitleTracks.find((x) => x.id === track.id);
              if (st) st.hidden = !st.hidden;
            })
          }
        >
          👁
        </button>
      </div>
      <div className={`relative flex-1 ${track.hidden ? 'opacity-40' : ''}`}>
        {visible.map((cue) => (
          <CueBlock
            key={cue.id}
            cue={previews?.[cue.id] ? { ...cue, ...previews[cue.id] } : cue}
            pps={pps}
            rtl={track.rtl}
            selected={selection.includes(cue.id)}
            ghost={!!previews?.[cue.id]}
            invalid={!!previews?.[cue.id] && !dragValid}
            warn={issues.has(cue.id)}
          />
        ))}
      </div>
    </div>
  );
});

function CueBlock(props: { cue: Cue; pps: number; rtl: boolean; selected: boolean; ghost: boolean; invalid: boolean; warn: boolean }) {
  const { cue, pps } = props;
  return (
    <div
      data-testid="cue"
      data-cue-id={cue.id}
      data-start={cue.start.toFixed(3)}
      data-end={cue.end.toFixed(3)}
      className={`absolute top-1 bottom-1 cursor-grab overflow-hidden rounded border px-1 text-[11px] leading-5 text-white select-none ${
        props.warn ? 'border-amber-400 bg-fuchsia-900/90' : 'border-fuchsia-400 bg-fuchsia-800/90'
      } ${props.selected ? 'ring-2 ring-white' : ''} ${props.ghost ? 'opacity-80' : ''} ${props.invalid ? 'border-red-500!' : ''}`}
      style={{ left: cue.start * pps, width: Math.max(2, (cue.end - cue.start) * pps) }}
      onPointerDown={(e) => beginCueDrag(e, cue.id, 'move')}
    >
      <span className="pointer-events-none block truncate" dir={props.rtl ? 'rtl' : 'ltr'}>
        {cue.text || '…'}
      </span>
      <div
        className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize hover:bg-white/60"
        onPointerDown={(e) => {
          e.stopPropagation();
          beginCueDrag(e, cue.id, 'trim-start');
        }}
      />
      <div
        className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize hover:bg-white/60"
        onPointerDown={(e) => {
          e.stopPropagation();
          beginCueDrag(e, cue.id, 'trim-end');
        }}
      />
    </div>
  );
}
