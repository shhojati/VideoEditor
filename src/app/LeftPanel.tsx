import { useTranslation } from 'react-i18next';
import { MediaBin } from '../features/media-bin/MediaBin';
import { SubtitlesPanel } from '../features/subtitles/SubtitlesPanel';
import { useSubtitlesUi } from '../features/subtitles/subtitlesUi';
import { TransitionsPanel } from '../features/transitions/TransitionsPanel';
import type { Project } from '../model/types';

/** Media bin and subtitle editor share the left column as tabs. */
export function LeftPanel({ project }: { project: Project }) {
  const { t } = useTranslation();
  const tab = useSubtitlesUi((s) => s.tab);
  const tabBtn = (id: 'media' | 'subtitles' | 'transitions', label: string) => (
    <button
      role="tab"
      aria-selected={tab === id}
      data-testid={`tab-${id}`}
      className={`min-w-0 flex-1 truncate px-1.5 py-1.5 text-xs font-medium ${tab === id ? 'border-b-2 border-accent text-white' : 'text-neutral-400 hover:text-white'}`}
      onClick={() => useSubtitlesUi.setState({ tab: id })}
    >
      {label}
    </button>
  );
  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-surface-1">
      {/* Phones switch these tabs from the bottom navigation instead. */}
      <div role="tablist" className="flex border-b border-line max-md:hidden">
        {tabBtn('media', t('panels.media'))}
        {tabBtn('subtitles', t('panels.subtitles'))}
        {tabBtn('transitions', t('panels.transitions'))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{tab === 'media' ? <MediaBin /> : tab === 'subtitles' ? <SubtitlesPanel project={project} /> : <TransitionsPanel />}</div>
    </section>
  );
}
