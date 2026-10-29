import { Clapperboard, LayoutTemplate, MessageSquareText, Shapes, WandSparkles, type LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { Icon } from './icons';
import { EffectsPanel } from '../features/effects/EffectsPanel';
import { FiltersPanel } from '../features/effects/FiltersPanel';
import { LibraryPanel } from '../features/library/LibraryPanel';
import { MediaBin } from '../features/media-bin/MediaBin';
import { SubtitlesPanel } from '../features/subtitles/SubtitlesPanel';
import { useSubtitlesUi, type AssetsKind, type FxView, type PanelTab, type SubtitlesView, type TemplatesView } from '../features/subtitles/subtitlesUi';
import { TransitionsPanel } from '../features/transitions/TransitionsPanel';
import { TranscriptPanel } from '../features/transcript/TranscriptPanel';
import { TemplatesPanel } from '../features/templates/TemplatesPanel';
import { LayoutsPanel } from '../features/layouts/LayoutsPanel';
import type { Project } from '../model/types';

export const PANEL_TABS: { id: PanelTab; label: string; icon: LucideIcon }[] = [
  { id: 'media', label: 'panels.media', icon: Clapperboard },
  { id: 'subtitles', label: 'panels.subtitles', icon: MessageSquareText },
  { id: 'fx', label: 'panels.fx', icon: WandSparkles },
  { id: 'assets', label: 'panels.assets', icon: Shapes },
  { id: 'templates', label: 'panels.templates', icon: LayoutTemplate },
];

const SUBTITLES_VIEWS: { id: SubtitlesView; label: string }[] = [
  { id: 'subtitles', label: 'panels.subtitles' },
  { id: 'transcript', label: 'panels.transcript' },
];

const FX_VIEWS: { id: FxView; label: string }[] = [
  { id: 'effects', label: 'panels.effects' },
  { id: 'transitions', label: 'panels.transitions' },
  { id: 'filters', label: 'panels.filters' },
];

const ASSETS_KINDS: { id: AssetsKind; label: string }[] = [
  { id: 'stickers', label: 'panels.stickers' },
  { id: 'sounds', label: 'panels.sounds' },
  { id: 'backgrounds', label: 'panels.backgrounds' },
  { id: 'overlays', label: 'panels.overlays' },
];

const TEMPLATES_VIEWS: { id: TemplatesView; label: string }[] = [
  { id: 'templates', label: 'panels.templates' },
  { id: 'layouts', label: 'panels.layouts' },
];

/**
 * A row of tabs; `small` for the second row inside a tab (Subtitles' views, Assets' libraries, …).
 * Always one line: the tabs share the width; when the row is too narrow for the labels, tabs with
 * an icon show just the icon (others truncate), with the full name as a tooltip.
 */
function TabRow<T extends string>({ tabs, current, onPick, small }: { tabs: { id: T; label: string; icon?: LucideIcon }[]; current: T; onPick: (id: T) => void; small?: boolean }) {
  const { t } = useTranslation();
  return (
    <div role="tablist" className={`@container flex border-b border-line md:gap-1 md:px-2.5 md:py-2.5 ${small ? 'bg-surface-2/50 md:py-2' : ''}`}>
      {tabs.map(({ id, label, icon }) => (
        <button
          key={id}
          role="tab"
          aria-selected={current === id}
          // A view named like its tab (Subtitles › Subtitles) gets its own test id.
          data-testid={small && PANEL_TABS.some((x) => x.id === id) ? `tab-${id}-view` : `tab-${id}`}
          title={t(label)}
          className={`flex min-w-0 flex-auto items-center justify-center whitespace-nowrap px-1 md:rounded-md ${small ? 'py-1 text-[10px] md:px-2 md:text-xs' : 'py-1.5 text-[11px] md:px-2 md:text-[13px]'} font-medium ${
            current === id
              ? 'bg-surface-2 text-white shadow-[inset_0_-2px_0_var(--color-accent)] md:bg-surface-3 md:shadow-none'
              : 'text-muted hover:text-white md:text-neutral-300 md:hover:bg-surface-2'
          }`}
          onClick={() => onPick(id)}
        >
          {icon && <Icon icon={icon} size={16} className="hidden shrink-0 @max-[22rem]:block" />}
          <span className={`max-w-full truncate ${icon ? '@max-[22rem]:hidden' : ''}`}>{t(label)}</span>
        </button>
      ))}
    </div>
  );
}

/**
 * The left column as tabs: media bin, subtitles (with editing by text), effects (with transitions
 * and filters), the server's asset libraries (with overlays), and templates (with layouts). `tabs` limits it to a
 * group (the phone layout opens one group per bottom-navigation button).
 */
export function LeftPanel({ project, tabs }: { project: Project; tabs?: PanelTab[] }) {
  const current = useSubtitlesUi((s) => s.tab);
  const subtitlesView = useSubtitlesUi((s) => s.subtitlesView);
  const fxView = useSubtitlesUi((s) => s.fxView);
  const assetsKind = useSubtitlesUi((s) => s.assetsKind);
  const templatesView = useSubtitlesUi((s) => s.templatesView);
  const shown = PANEL_TABS.filter((x) => !tabs || tabs.includes(x.id));
  const tab = shown.some((x) => x.id === current) ? current : shown[0].id;
  return (
    <section className="flex min-h-0 min-w-0 flex-col bg-surface-1 md:rounded-lg md:border md:border-line">
      {shown.length > 1 && <TabRow tabs={shown} current={tab} onPick={(id) => useSubtitlesUi.setState({ tab: id })} />}
      {tab === 'subtitles' && (
        <TabRow small tabs={SUBTITLES_VIEWS} current={subtitlesView} onPick={(id) => useSubtitlesUi.setState({ subtitlesView: id })} />
      )}
      {tab === 'fx' && <TabRow small tabs={FX_VIEWS} current={fxView} onPick={(id) => useSubtitlesUi.setState({ fxView: id })} />}
      {tab === 'assets' && <TabRow small tabs={ASSETS_KINDS} current={assetsKind} onPick={(id) => useSubtitlesUi.setState({ assetsKind: id })} />}
      {tab === 'templates' && (
        <TabRow small tabs={TEMPLATES_VIEWS} current={templatesView} onPick={(id) => useSubtitlesUi.setState({ templatesView: id })} />
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'media' ? (
          <MediaBin />
        ) : tab === 'subtitles' ? (
          subtitlesView === 'transcript' ? <TranscriptPanel project={project} /> : <SubtitlesPanel project={project} />
        ) : tab === 'assets' ? (
          <LibraryPanel kind={assetsKind} />
        ) : tab === 'templates' ? (
          templatesView === 'layouts' ? <LayoutsPanel /> : <TemplatesPanel />
        ) : fxView === 'transitions' ? (
          <TransitionsPanel />
        ) : fxView === 'filters' ? (
          <FiltersPanel />
        ) : (
          <EffectsPanel />
        )}
      </div>
    </section>
  );
}
