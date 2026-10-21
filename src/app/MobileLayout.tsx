import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Inspector } from '../features/inspector/Inspector';
import { PreviewPanel } from '../features/preview/PreviewPanel';
import { useSubtitlesUi, type PanelTab } from '../features/subtitles/subtitlesUi';
import { TimelinePanel } from '../features/timeline/TimelinePanel';
import { useTimelineUi } from '../features/timeline/timelineUi';
import type { Project } from '../model/types';
import { ErrorBoundary } from './ErrorBoundary';
import { useMobileUi, useTimelineShare } from './layout';
import { TimelineSplitter } from './Splitter';
import { LeftPanel } from './LeftPanel';

type NavId = 'media' | 'subtitles' | 'library' | 'fx' | 'inspector';
/** Each button opens a group of left-panel tabs (or the inspector). */
const NAV: { id: NavId; icon: string; label: string; tabs?: PanelTab[] }[] = [
  { id: 'media', icon: '🎞', label: 'panels.media', tabs: ['media'] },
  { id: 'subtitles', icon: '💬', label: 'panels.subtitles', tabs: ['subtitles', 'transcript'] },
  { id: 'library', icon: '🌟', label: 'panels.library', tabs: ['stickers', 'sounds', 'overlays', 'templates'] },
  { id: 'fx', icon: '✨', label: 'panels.fx', tabs: ['layouts', 'transitions', 'effects', 'filters'] },
  { id: 'inspector', icon: '⚙', label: 'panels.inspector' },
];
const navOf = (tab: PanelTab) => NAV.find((n) => n.tabs?.includes(tab))!.id;

/**
 * Phone layout: preview on top, timeline below, and a bottom navigation whose tabs open the side
 * panels as a sheet over the timeline — the preview stays visible while editing properties.
 */
export function MobileLayout({ project }: { project: Project }) {
  const { t } = useTranslation();
  const sheet = useMobileUi((s) => s.sheet);
  const tab = useSubtitlesUi((s) => s.tab);
  const hasSelection = useTimelineUi((s) => s.selection.length > 0);
  const timelineShare = useTimelineShare((s) => s.mobile);
  const timelineRef = useRef<HTMLDivElement>(null);
  const active: NavId | null = sheet === 'inspector' ? 'inspector' : sheet === 'panels' ? navOf(tab) : null;

  const open = (id: NavId) => {
    if (id === active) return useMobileUi.setState({ sheet: null });
    if (id === 'inspector') return useMobileUi.setState({ sheet: 'inspector' });
    const tabs = NAV.find((n) => n.id === id)!.tabs!;
    if (!tabs.includes(tab)) useSubtitlesUi.setState({ tab: tabs[0] });
    useMobileUi.setState({ sheet: 'panels' });
  };

  return (
    <main className="flex min-h-0 flex-1 flex-col" data-testid="mobile-layout">
      <div className="grid min-h-[120px] flex-1">
        <ErrorBoundary area={t('panels.preview')}>
          <PreviewPanel project={project} />
        </ErrorBoundary>
      </div>
      <TimelineSplitter kind="mobile" target={timelineRef} />
      <div ref={timelineRef} className="relative flex min-h-[120px] shrink-0 flex-col" style={{ height: `${timelineShare * 100}%` }}>
        <ErrorBoundary area={t('panels.timeline')}>
          <TimelinePanel project={project} />
        </ErrorBoundary>
        {active && (
          <section
            // At least half the screen even when the timeline is resized small.
            className="absolute inset-x-0 bottom-0 z-40 flex h-full min-h-[50svh] flex-col border-t border-line bg-surface-1 shadow-[0_-8px_24px_rgba(0,0,0,0.5)]"
            aria-label={t(NAV.find((n) => n.id === active)!.label)}
            data-testid="mobile-sheet"
          >
            <div className="flex items-center border-b border-line ps-3">
              <h2 className="flex-1 text-sm font-medium text-white">{t(NAV.find((n) => n.id === active)!.label)}</h2>
              <button
                className="px-4 py-2 text-lg leading-none text-neutral-400 hover:text-white"
                aria-label={t('panels.close')}
                onClick={() => useMobileUi.setState({ sheet: null })}
              >
                ✕
              </button>
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              {active === 'inspector' ? (
                <ErrorBoundary area={t('panels.inspector')}>
                  <Inspector project={project} />
                </ErrorBoundary>
              ) : (
                <ErrorBoundary area={t('panels.media')}>
                  <LeftPanel project={project} tabs={NAV.find((n) => n.id === active)!.tabs} />
                </ErrorBoundary>
              )}
            </div>
          </section>
        )}
      </div>
      <nav className="flex shrink-0 border-t border-line bg-surface-1 pb-[env(safe-area-inset-bottom)]">
        {NAV.map((n) => (
          <button
            key={n.id}
            aria-pressed={active === n.id}
            data-testid={`nav-${n.id}`}
            className={`relative flex min-w-0 flex-1 flex-col items-center gap-0.5 py-1.5 text-[11px] ${
              active === n.id ? 'text-white' : 'text-neutral-400'
            }`}
            onClick={() => open(n.id)}
          >
            {active === n.id && <span className="absolute inset-x-4 top-0 h-0.5 rounded bg-accent" />}
            <span className="text-lg leading-none" aria-hidden>
              {n.icon}
            </span>
            <span className="max-w-full truncate px-1">{t(n.label)}</span>
            {/* Something is selected: its properties are one tap away. */}
            {n.id === 'inspector' && hasSelection && active !== 'inspector' && (
              <span className="absolute top-1 left-[calc(50%+10px)] h-2 w-2 rounded-full bg-accent" />
            )}
          </button>
        ))}
      </nav>
    </main>
  );
}
