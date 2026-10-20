import { useTranslation } from 'react-i18next';
import { TRANSITION_KINDS } from '../../model/transitions';
import type { TransitionKind } from '../../model/types';
import { useTimelineUi } from '../timeline/timelineUi';
import { transitionDrag } from './transitionActions';

/** Small icon per kind (no external assets). */
export const TRANSITION_ICON: Record<TransitionKind, string> = {
  crossfade: '◐',
  dipBlack: '●',
  dipWhite: '○',
  wipeLeft: '⇠',
  wipeRight: '⇢',
  wipeUp: '⇡',
  wipeDown: '⇣',
  slideLeft: '⇐',
  slideRight: '⇒',
  pushLeft: '⇇',
  pushRight: '⇉',
  zoomIn: '⊕',
  zoomOut: '⊖',
  blur: '≋',
};

export function TransitionsPanel() {
  const { t } = useTranslation();
  return (
    <div className="space-y-2 p-2 text-xs" data-testid="transitions-panel">
      <p className="text-neutral-400">{t('transitions.help')}</p>
      <ul className="grid grid-cols-2 gap-1.5">
        {TRANSITION_KINDS.map((kind) => (
          <li
            key={kind}
            draggable
            data-testid={`transition-${kind}`}
            className="flex cursor-grab items-center gap-2 rounded border border-line bg-surface-2 px-2 py-2 hover:border-accent"
            onDragStart={(e) => {
              transitionDrag.kind = kind;
              e.dataTransfer.effectAllowed = 'copy';
              e.dataTransfer.setData('application/x-video-editor-transition', kind);
            }}
            onDragEnd={() => {
              transitionDrag.kind = null;
              useTimelineUi.setState({ cutHover: undefined });
            }}
          >
            <span className="w-5 text-center text-base leading-none" aria-hidden>
              {TRANSITION_ICON[kind]}
            </span>
            <span>{t(`transitions.kinds.${kind}`)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
