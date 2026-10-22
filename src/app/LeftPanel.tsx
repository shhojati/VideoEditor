import { useTranslation } from 'react-i18next';
import { EffectsPanel } from '../features/effects/EffectsPanel';
import { FiltersPanel } from '../features/effects/FiltersPanel';
import { LibraryPanel } from '../features/library/LibraryPanel';
import { MediaBin } from '../features/media-bin/MediaBin';
import { SubtitlesPanel } from '../features/subtitles/SubtitlesPanel';
import { useSubtitlesUi, type PanelTab } from '../features/subtitles/subtitlesUi';
import { TransitionsPanel } from '../features/transitions/TransitionsPanel';
import { TranscriptPanel } from '../features/transcript/TranscriptPanel';
import { TemplatesPanel } from '../features/templates/TemplatesPanel';
import { LayoutsPanel } from '../features/layouts/LayoutsPanel';
import type { Project } from '../model/types';

export const PANEL_TABS: { id: PanelTab; label: string }[] = [
  { id: 'media', label: 'panels.media' },
  { id: 'subtitles', label: 'panels.subtitles' },
  { id: 'transcript', label: 'panels.transcript' },
  { id: 'stickers', label: 'panels.stickers' },
  { id: 'sounds', label: 'panels.sounds' },
  { id: 'overlays', label: 'panels.overlays' },
  { id: 'templates', label: 'panels.templates' },
  { id: 'layouts', label: 'panels.layouts' },
  { id: 'transitions', label: 'panels.transitions' },
  { id: 'effects', label: 'panels.effects' },
  { id: 'filters', label: 'panels.filters' },
];

/**
 * The left column: media bin, subtitles, the server library panes, transitions, effects and filters, as tabs.
 * `tabs` limits it to a group (the phone layout opens one group per bottom-navigation button).
 */
export function LeftPanel({ project, tabs }: { project: Project; tabs?: PanelTab[] }) {
  const { t } = useTranslation();
  const current = useSubtitlesUi((s) => s.tab);
  const shown = PANEL_TABS.filter((x) => !tabs || tabs.includes(x.id));
  const tab = shown.some((x) => x.id === current) ? current : shown[0].id;
  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-surface-1">
      {shown.length > 1 && (
        <div role="tablist" className="grid grid-cols-[repeat(auto-fit,minmax(56px,1fr))] border-b border-line">
          {shown.map(({ id, label }) => (
            <button
              key={id}
              role="tab"
              aria-selected={tab === id}
              data-testid={`tab-${id}`}
              title={t(label)}
              className={`flex min-w-0 items-center justify-center px-1 py-1.5 text-[11px] font-medium ${
                tab === id ? 'bg-surface-2 text-white shadow-[inset_0_-2px_0_var(--color-accent)]' : 'text-neutral-400 hover:text-white'
              }`}
              onClick={() => useSubtitlesUi.setState({ tab: id })}
            >
              <span className="max-w-full truncate">{t(label)}</span>
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'media' ? (
          <MediaBin />
        ) : tab === 'subtitles' ? (
          <SubtitlesPanel project={project} />
        ) : tab === 'templates' ? (
          <TemplatesPanel />
        ) : tab === 'layouts' ? (
          <LayoutsPanel />
        ) : tab === 'transcript' ? (
          <TranscriptPanel project={project} />
        ) : tab === 'transitions' ? (
          <TransitionsPanel />
        ) : tab === 'effects' ? (
          <EffectsPanel />
        ) : tab === 'filters' ? (
          <FiltersPanel />
        ) : (
          <LibraryPanel kind={tab} />
        )}
      </div>
    </section>
  );
}
