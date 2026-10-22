import { useTranslation } from 'react-i18next';
import { cutsOf, kindsFor, maxTransitionDuration, MIN_TRANSITION_DURATION, updateTransition } from '../../model/transitions';
import type { ID, Project } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { TRANSITION_ICON } from '../transitions/TransitionsPanel';
import { applyTransition, deleteTransitions } from '../transitions/transitionActions';
import { NumberField, Section } from './controls';
import { resetTransitionDuration, resetTransitionKind } from './resetActions';

/** Edit the transition on a cut, or pick one for a cut that has none. */
export function TransitionInspector({ project, fromId, toId }: { project: Project; fromId: ID; toId: ID }) {
  const { t } = useTranslation();
  const edit = useProjectStore((s) => s.edit);
  const cut = cutsOf(project).find((c) => c.from.id === fromId && c.to.id === toId);
  if (!cut) return null;
  const { track, from, to, transition } = cut;
  const others = { ...track, transitions: (track.transitions ?? []).filter((x) => x !== transition) };
  const max = maxTransitionDuration(others, from, to);
  const name = (c: typeof from) =>
    c.text ? c.text.content : c.shape ? t(`shapes.${c.shape.kind}`) : (project.assets[c.assetId ?? '']?.name ?? '');

  return (
    <div data-testid="transition-inspector">
      <div className="border-b border-line px-3 py-2 text-sm font-medium text-white">{t('transitions.title')}</div>
      <p className="truncate px-3 pt-2 text-xs text-neutral-400" dir="auto">
        {name(from)} → {name(to)}
      </p>
      <Section id="transitionKind" title={t('transitions.kind')} onReset={transition ? () => resetTransitionKind(transition.id) : undefined}>
        <div className="grid grid-cols-2 gap-1 text-xs">
          {kindsFor(track).map((kind) => (
            <button
              key={kind}
              data-testid={`pick-${kind}`}
              className={`flex items-center gap-1.5 rounded px-2 py-1 text-start ${
                transition?.kind === kind ? 'bg-accent text-white' : 'bg-surface-3 hover:bg-[#363c49]'
              }`}
              onClick={() =>
                transition
                  ? edit('ops.transitionKind', (p) => updateTransition(p, transition.id, { kind }))
                  : applyTransition(from.id, to.id, kind)
              }
            >
              <span aria-hidden>{TRANSITION_ICON[kind]}</span>
              {t(`transitions.kinds.${kind}`)}
            </button>
          ))}
        </div>
        {max < MIN_TRANSITION_DURATION && <p className="text-xs text-amber-300">{t('transitions.tooShort')}</p>}
      </Section>
      {transition && (
        <Section id="transitionTiming" title={t('transitions.timing')} onReset={() => resetTransitionDuration(transition.id)}>
          <NumberField
            label={t('inspector.duration')}
            value={transition.duration}
            min={MIN_TRANSITION_DURATION}
            max={Math.max(MIN_TRANSITION_DURATION, max)}
            step={0.05}
            unit="s"
            onChange={(v) =>
              edit('ops.transitionDuration', (p) => updateTransition(p, transition.id, { duration: v }), {
                mergeKey: `${transition.id}:duration`,
              })
            }
          />
          <p className="text-[11px] text-neutral-400">{t('transitions.handlesNote')}</p>
          <button
            className="rounded bg-surface-3 px-2 py-1 text-xs text-red-300 hover:bg-red-900/50"
            onClick={() => deleteTransitions(new Set([transition.id]))}
            data-testid="remove-transition"
          >
            {t('transitions.remove')}
          </button>
        </Section>
      )}
    </div>
  );
}
