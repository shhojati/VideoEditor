import { Smartphone, WandSparkles } from 'lucide-react';
import { Icon } from '../../app/icons';
import { useTranslation } from 'react-i18next';
import { aspectOf } from '../../model/factories';
import type { Clip, Project } from '../../model/types';
import { Section } from '../inspector/controls';
import { autoReframe, cancelReframe, reframeProject, useReframe } from './reframeService';
import { ProBadge } from '../account/ProBadge';
import { resetClipSection } from '../inspector/resetActions';

const btn = 'rounded bg-surface-3 px-2 py-1 text-xs hover:bg-surface-4 disabled:opacity-40';

/** Auto reframe (Pro): keep the person in the middle when the clip's shape differs from the frame. */
export function ReframeSection({ project, clip }: { project: Project; clip: Clip }) {
  const { t } = useTranslation();
  const state = useReframe();
  const busy = !!state.clipId;
  const vertical = aspectOf(project.settings) === '9:16';
  return (
    <Section id="reframe" title={t('reframe.title')} onReset={clip.motion?.mode === 'reframe' && !busy ? () => resetClipSection(clip.id, 'reframe') : undefined}>
      <div className="space-y-2" data-testid="reframe-section">
        <p className="text-[11px] text-neutral-400">{t('reframe.intro')}</p>
        {busy ? (
          <div className="flex items-center gap-2" data-testid="reframe-progress">
            <div className="h-1.5 flex-1 rounded bg-surface-3">
              <div className="h-1.5 rounded bg-accent" style={{ width: `${Math.round(state.progress * 100)}%` }} />
            </div>
            <span className="text-[11px] text-neutral-300">
              {Math.round(state.progress * 100)}%{state.queue.length ? ` · ${t('reframe.left', { count: state.queue.length })}` : ''}
            </span>
            <button className={btn} onClick={cancelReframe}>
              {t('tracking.cancel')}
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1">
            <button className={btn} data-testid="reframe-clip" onClick={() => void autoReframe(clip.id)}>
              <Icon icon={WandSparkles} size={14} />
              {clip.motion?.mode === 'reframe' ? t('reframe.again') : t('reframe.clip')} <ProBadge />
            </button>
            {!vertical && (
              <button className={btn} data-testid="reframe-project" onClick={() => void reframeProject('9:16')}>
                <Icon icon={Smartphone} size={14} />
                {t('reframe.project')} <ProBadge />
              </button>
            )}
          </div>
        )}
        {state.error && !busy && <p className="text-[11px] text-red-300">{t(`reframe.errors.${state.error}`)}</p>}
      </div>
    </Section>
  );
}
