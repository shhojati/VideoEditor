import { useTranslation } from 'react-i18next';
import { DEFAULT_EASE, KEY_EASES } from '../../model/keyframes';
import type { Clip, Project } from '../../model/types';
import { Section, SelectField } from '../inspector/controls';
import { clearKeyframes, isInside, jumpToKeyframe, keyAtPlayhead, setEaseAtPlayhead, toggleKeyframe } from './keyframeService';

const btn = 'rounded bg-surface-3 px-2 py-1 text-xs hover:bg-[#363c49] disabled:opacity-40';

/** The clip's keyframes, InShot style: ◆ adds/removes one at the playhead; ◀ ▶ jump; ease of the one under the playhead. */
export function KeyframesSection({ project, clip, time }: { project: Project; clip: Clip; time: number }) {
  const { t } = useTranslation();
  const keys = clip.keyframes ?? [];
  const inside = isInside(clip, time);
  const index = inside ? keyAtPlayhead(project, clip, time) : -1;
  const here = index >= 0;
  return (
    <Section title={t('keyframes.title')}>
      <div className="space-y-2" data-testid="keyframes-section">
        <div className="flex items-center gap-1" dir="ltr">
          <button className={btn} disabled={!keys.length} title={t('keyframes.prev')} aria-label={t('keyframes.prev')} onClick={() => jumpToKeyframe(clip.id, -1)}>
            ◀
          </button>
          <button
            className={`${btn} flex-1 ${here ? 'text-sky-300' : ''}`}
            data-testid="keyframe-toggle"
            disabled={!inside}
            title={`${t(here ? 'keyframes.remove' : 'keyframes.add')} (K)`}
            onClick={() => toggleKeyframe(clip.id)}
          >
            {here ? '◆−' : '◆+'} {t(here ? 'keyframes.remove' : 'keyframes.add')}
          </button>
          <button className={btn} disabled={!keys.length} title={t('keyframes.next')} aria-label={t('keyframes.next')} onClick={() => jumpToKeyframe(clip.id, 1)}>
            ▶
          </button>
        </div>
        <p className="text-[11px] text-neutral-400">
          {!inside ? t('keyframes.outside') : keys.length ? t('keyframes.count', { count: keys.length }) : t('keyframes.intro')}
        </p>
        {here && (
          <SelectField
            label={t('keyframes.ease')}
            value={keys[index].ease ?? DEFAULT_EASE}
            options={KEY_EASES.map((e) => ({ value: e, label: t(`keyframes.eases.${e}`) }))}
            onChange={(v) => setEaseAtPlayhead(clip.id, v)}
          />
        )}
        {keys.length > 0 && (
          <button className={`${btn} text-red-300`} data-testid="keyframes-clear" onClick={() => clearKeyframes(clip.id)}>
            {t('keyframes.clear')}
          </button>
        )}
      </div>
    </Section>
  );
}
