import { useTranslation } from 'react-i18next';
import { EffectsPanel } from '../features/effects/EffectsPanel';
import { FiltersPanel } from '../features/effects/FiltersPanel';
import { LibraryPanel } from '../features/library/LibraryPanel';
import { MediaBin } from '../features/media-bin/MediaBin';
import { SubtitlesPanel } from '../features/subtitles/SubtitlesPanel';
import { useSubtitlesUi, type AssetsKind, type PanelTab, type SubtitlesView } from '../features/subtitles/subtitlesUi';
import { TransitionsPanel } from '../features/transitions/TransitionsPanel';
import { TranscriptPanel } from '../features/transcript/TranscriptPanel';
import { TemplatesPanel } from '../features/templates/TemplatesPanel';
import { LayoutsPanel } from '../features/layouts/LayoutsPanel';
import type { Project } from '../model/types';

export const PANEL_TABS: { id: PanelTab; label: string }[] = [
  { id: 'media', label: 'panels.media' },
  { id: 'subtitles', label: 'panels.subtitles' },
  { id: 'effects', label: 'panels.effects' },
  { id: 'assets', label: 'panels.assets' },
  { id: 'transitions', label: 'panels.transitions' },
  { id: 'overlays', label: 'panels.overlays' },
  { id: 'filters', label: 'panels.filters' },
  { id: 'layouts', label: 'panels.layouts' },
  { id: 'templates', label: 'panels.templates' },
];

const SUBTITLES_VIEWS: { id: SubtitlesView; label: string }[] = [
  { id: 'subtitles', label: 'panels.subtitles' },
  { id: 'transcript', label: 'panels.transcript' },
];

const ASSETS_KINDS: { id: AssetsKind; label: string }[] = [
  { id: 'stickers', label: 'panels.stickers' },
  { id: 'sounds', label: 'panels.sounds' },
  { id: 'backgrounds', label: 'panels.backgrounds' },
];

/** A row of tabs; `small` for the second row inside a tab (Subtitles' views, Assets' libraries). */
function TabRow<T extends string>({ tabs, current, onPick, small }: { tabs: { id: T; label: string }[]; current: T; onPick: (id: T) => void; small?: boolean }) {
  const { t } = useTranslation();
  return (
    <div role="tablist" className={`grid grid-cols-[repeat(auto-fit,minmax(56px,1fr))] border-b border-line md:flex md:flex-wrap md:gap-1 md:px-2.5 md:py-2.5 ${small ? 'bg-surface-2/50 md:py-2' : ''}`}>
      {tabs.map(({ id, label }) => (
        <button
          key={id}
          role="tab"
          aria-selected={current === id}
          data-testid={`tab-${id}`}
          title={t(label)}
          className={`flex min-w-0 items-center justify-center px-1 md:rounded-md ${small ? 'py-1 text-[10px] md:px-2.5 md:text-xs' : 'py-1.5 text-[11px] md:px-3 md:text-[13px]'} font-medium ${
            current === id
              ? 'bg-surface-2 text-white shadow-[inset_0_-2px_0_var(--color-accent)] md:bg-surface-3 md:shadow-none'
              : 'text-muted hover:text-white md:text-neutral-300 md:hover:bg-surface-2'
          }`}
          onClick={() => onPick(id)}
        >
          <span className="max-w-full truncate">{t(label)}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The left column: media bin, subtitles (with editing by text), effects, the server's asset
 * libraries, transitions, overlays, filters, layouts and templates, as tabs. `tabs` limits it to a
 * group (the phone layout opens one group per bottom-navigation button).
 */
export function LeftPanel({ project, tabs }: { project: Project; tabs?: PanelTab[] }) {
  const current = useSubtitlesUi((s) => s.tab);
  const subtitlesView = useSubtitlesUi((s) => s.subtitlesView);
  const assetsKind = useSubtitlesUi((s) => s.assetsKind);
  const shown = PANEL_TABS.filter((x) => !tabs || tabs.includes(x.id));
  const tab = shown.some((x) => x.id === current) ? current : shown[0].id;
  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-surface-1 md:rounded-lg md:border md:border-line">
      {shown.length > 1 && <TabRow tabs={shown} current={tab} onPick={(id) => useSubtitlesUi.setState({ tab: id })} />}
      {tab === 'subtitles' && (
        <TabRow small tabs={SUBTITLES_VIEWS} current={subtitlesView} onPick={(id) => useSubtitlesUi.setState({ subtitlesView: id })} />
      )}
      {tab === 'assets' && <TabRow small tabs={ASSETS_KINDS} current={assetsKind} onPick={(id) => useSubtitlesUi.setState({ assetsKind: id })} />}
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'media' ? (
          <MediaBin />
        ) : tab === 'subtitles' ? (
          subtitlesView === 'transcript' ? <TranscriptPanel project={project} /> : <SubtitlesPanel project={project} />
        ) : tab === 'assets' ? (
          <LibraryPanel kind={assetsKind} />
        ) : tab === 'templates' ? (
          <TemplatesPanel />
        ) : tab === 'layouts' ? (
          <LayoutsPanel />
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
