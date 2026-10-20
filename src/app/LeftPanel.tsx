import { useTranslation } from 'react-i18next';
import { MediaBin } from '../features/media-bin/MediaBin';
import { SubtitlesPanel } from '../features/subtitles/SubtitlesPanel';
import { useSubtitlesUi } from '../features/subtitles/subtitlesUi';
import type { Project } from '../model/types';

/** Media bin and subtitle editor share the left column as tabs. */
export function LeftPanel({ project }: { project: Project }) {
  const { t } = useTranslation();
  const tab = useSubtitlesUi((s) => s.tab);
  const tabBtn = (id: 'media' | 'subtitles', label: string) => (
    <button
      role="tab"
      aria-selected={tab === id}
      data-testid={`tab-${id}`}
      className={`flex-1 px-3 py-1.5 text-xs font-medium ${tab === id ? 'border-b-2 border-accent text-white' : 'text-neutral-400 hover:text-white'}`}
      onClick={() => useSubtitlesUi.setState({ tab: id })}
    >
      {label}
    </button>
  );
  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-surface-1">
      <div role="tablist" className="flex border-b border-line">
        {tabBtn('media', t('panels.media'))}
        {tabBtn('subtitles', t('panels.subtitles'))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{tab === 'media' ? <MediaBin /> : <SubtitlesPanel project={project} />}</div>
    </section>
  );
}
