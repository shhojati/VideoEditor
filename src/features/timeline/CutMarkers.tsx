import { useTranslation } from 'react-i18next';
import { cutsOf } from '../../model/transitions';
import type { Project, Track } from '../../model/types';
import { TRANSITION_ICON } from '../transitions/TransitionsPanel';
import { cutKey } from '../transitions/transitionActions';
import { select, TRACK_HEIGHT, useTimelineUi } from './timelineUi';

/**
 * Markers on the cuts between touching clips of one track: a badge spanning each transition, or a
 * small handle where one can be added. Clicking selects the cut (the inspector edits it). They sit in a
 * slim strip at the bottom of the lane so the clips' trim handles at the cut stay reachable.
 */
export function CutMarkers({ project, track, pps }: { project: Project; track: Track; pps: number }) {
  const { t } = useTranslation();
  const selection = useTimelineUi((s) => s.selection);
  const hover = useTimelineUi((s) => s.cutHover);
  const cuts = cutsOf(project).filter((c) => c.track.id === track.id);

  return (
    <>
      {cuts.map(({ from, to, transition }) => {
        const key = cutKey(from.id, to.id);
        const x = to.start * pps;
        const selected = selection.includes(transition?.id ?? key);
        const highlighted = hover === key;
        if (transition) {
          const w = Math.max(16, transition.duration * pps);
          return (
            <button
              key={key}
              data-testid="transition-badge"
              data-kind={transition.kind}
              data-duration={transition.duration.toFixed(3)}
              title={`${t(`transitions.kinds.${transition.kind}`)} · ${transition.duration.toFixed(2)}s`}
              aria-label={t(`transitions.kinds.${transition.kind}`)}
              className={`absolute z-10 flex items-center justify-center rounded border text-[10px] leading-none text-white ${
                selected ? 'border-white bg-accent' : highlighted ? 'border-white bg-accent/70' : 'border-white/60 bg-black/60'
              } ${track.locked ? 'pointer-events-none' : ''}`}
              style={{ left: x - w / 2, width: w, top: TRACK_HEIGHT - 15, height: 14 }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() => select([transition.id])}
            >
              {TRANSITION_ICON[transition.kind]}
            </button>
          );
        }
        if (track.locked) return null;
        return (
          <button
            key={key}
            data-testid="cut-handle"
            aria-label={t('transitions.addAtCut')}
            title={t('transitions.addAtCut')}
            // The ::after pseudo-element widens the hit area for fingers.
            className={`absolute z-10 h-2.5 w-2.5 rotate-45 rounded-sm border transition-opacity pointer-coarse:after:absolute pointer-coarse:after:-inset-2 pointer-coarse:after:content-[''] ${
              selected || highlighted ? 'border-white bg-accent opacity-100' : 'border-white/70 bg-surface-3 opacity-40 hover:opacity-100'
            }`}
            style={{ left: x - 5, top: TRACK_HEIGHT - 11 }}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={() => select([key])}
          />
        );
      })}
    </>
  );
}
