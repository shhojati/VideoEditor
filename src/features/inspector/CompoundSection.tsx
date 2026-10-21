import { useTranslation } from 'react-i18next';
import type { Clip, Project } from '../../model/types';
import { breakApartClip, enterCompound, renameCompound } from '../timeline/compoundActions';
import { Section } from './controls';

/** A compound clip: its name, open it, or put its clips back on the timeline. */
export function CompoundSection({ project, clip }: { project: Project; clip: Clip }) {
  const { t } = useTranslation();
  const seq = project.sequences?.[clip.sequenceId!];
  if (!seq) return null;
  const count = seq.tracks.reduce((n, tr) => n + tr.clips.length, 0);
  return (
    <Section title={t('compound.title')}>
      <div className="space-y-2 text-xs" data-testid="compound-section">
        <label className="flex items-center gap-2">
          <span className="w-16 text-neutral-400">{t('compound.nameLabel')}</span>
          <input className="min-w-0 flex-1 rounded bg-surface-3 px-2 py-1" value={seq.name} onChange={(e) => renameCompound(seq.id, e.target.value)} />
        </label>
        <p className="text-neutral-400">{t('compound.contains', { count })}</p>
        <div className="flex gap-1">
          <button className="rounded bg-surface-3 px-2 py-1 hover:bg-[#363c49]" data-testid="compound-open" onClick={() => enterCompound(clip.id)}>
            ▣ {t('compound.open')}
          </button>
          <button className="rounded bg-surface-3 px-2 py-1 hover:bg-[#363c49]" data-testid="compound-break" onClick={() => breakApartClip(clip.id)}>
            {t('compound.break')}
          </button>
        </div>
      </div>
    </Section>
  );
}
