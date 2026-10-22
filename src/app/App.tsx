import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { playbackEngine } from '../engine/playback/engine';
import { ExportDialog } from '../features/export/ExportDialog';
import { RecordDialog } from '../features/record/RecordDialog';
import { projectDuckPlan } from '../features/media-bin/speechActivity';
import { readyNoiseProfiles } from '../features/media-bin/audioAnalysis';
import { Inspector } from '../features/inspector/Inspector';
import { startMediaWatcher } from '../features/media-bin/mediaService';
import { PreviewPanel } from '../features/preview/PreviewPanel';
import { NewProjectDialog } from '../features/projects/NewProjectDialog';
import { bootstrap } from '../features/projects/session';
import { TimelinePanel } from '../features/timeline/TimelinePanel';
import { HEADER_WIDTH, HEADER_WIDTH_COMPACT, useTimelineUi } from '../features/timeline/timelineUi';
import { startAutosave } from '../store/autosave';
import { useProject, useRootProject } from '../store/projectStore';
import { ErrorBoundary } from './ErrorBoundary';
import { useColumnShare, useIsMobile, useTimelineShare } from './layout';
import { LeftPanel } from './LeftPanel';
import { MobileLayout } from './MobileLayout';
import { ColumnSplitter, TimelineSplitter } from './Splitter';
import { Onboarding } from './Onboarding';
import { useGlobalShortcuts } from './shortcuts';
import { ShortcutSheet } from './ShortcutSheet';
import { AccountDialogs } from '../features/account/AccountDialogs';
import { Splash } from './Splash';
import { StartupCheck } from './StartupCheck';
import { Toasts } from './toasts';
import { TopBar } from './TopBar';

export function App() {
  return (
    <div className="flex h-full flex-col">
      <StartupCheck>
        <Editor />
      </StartupCheck>
      <Toasts />
      <Splash />
    </div>
  );
}

/** Only mounted once the browser passed the capability check. */
function Editor() {
  const { t, i18n } = useTranslation();
  const project = useProject();
  // Export always takes the whole document, also while a compound clip is open.
  const root = useRootProject();
  const mobile = useIsMobile();
  const timelineShare = useTimelineShare((s) => s.desktop);
  const timelineRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLElement>(null);
  const columns = useColumnShare();
  useGlobalShortcuts();

  useEffect(() => useTimelineUi.setState({ headerWidth: mobile ? HEADER_WIDTH_COMPACT : HEADER_WIDTH }), [mobile]);

  useEffect(() => {
    const stopAutosave = startAutosave();
    const stopMedia = startMediaWatcher();
    playbackEngine.audioAux = (p) => ({ duck: projectDuckPlan(p), noise: readyNoiseProfiles(p) });
    const stopPlayback = playbackEngine.init();
    void bootstrap(t('app.untitled'));
    return () => {
      stopAutosave();
      stopMedia();
      stopPlayback();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once on startup
  }, []);

  return (
    <>
      <ErrorBoundary area={t('app.title')}>
        <TopBar />
      </ErrorBoundary>
      {project && mobile && (
        <>
          <MobileLayout project={project} />
          <ErrorBoundary area={t('export.title')}>
            {root && <ExportDialog project={root} />}
          </ErrorBoundary>
          <ErrorBoundary area={t('record.title')}>
            <RecordDialog />
          </ErrorBoundary>
          <Onboarding project={project} />
        </>
      )}
      {project && !mobile && (
        <>
          {/* Panels sit as in English in both languages (Media left, Properties right); only their contents follow the language. */}
          <main
            ref={mainRef}
            className={`grid min-h-0 flex-1 [direction:ltr] ${i18n.dir() === 'rtl' ? '[&>*]:[direction:rtl]' : ''}`}
            style={{ gridTemplateColumns: `max(160px, ${columns.start * 100}%) 4px minmax(0, 1fr) 4px max(160px, ${columns.end * 100}%)` }}
          >
            <ErrorBoundary area={t('panels.media')}>
              <LeftPanel project={project} />
            </ErrorBoundary>
            <ColumnSplitter column="start" container={mainRef} />
            <ErrorBoundary area={t('panels.preview')}>
              <PreviewPanel project={project} />
            </ErrorBoundary>
            <ColumnSplitter column="end" container={mainRef} />
            <ErrorBoundary area={t('panels.inspector')}>
              <Inspector project={project} />
            </ErrorBoundary>
          </main>
          <ErrorBoundary area={t('export.title')}>
            {root && <ExportDialog project={root} />}
          </ErrorBoundary>
          <ErrorBoundary area={t('record.title')}>
            <RecordDialog />
          </ErrorBoundary>
          <TimelineSplitter kind="desktop" target={timelineRef} />
          <div ref={timelineRef} className="flex min-h-[120px] shrink-0 flex-col" style={{ height: `${timelineShare * 100}%` }}>
            <ErrorBoundary area={t('panels.timeline')}>
              <TimelinePanel project={project} />
            </ErrorBoundary>
          </div>
          <Onboarding project={project} />
        </>
      )}
      <NewProjectDialog />
      <ShortcutSheet />
      <AccountDialogs />
    </>
  );
}
