import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { playbackEngine } from '../engine/playback/engine';
import { ExportDialog } from '../features/export/ExportDialog';
import { Inspector } from '../features/inspector/Inspector';
import { startMediaWatcher } from '../features/media-bin/mediaService';
import { PreviewPanel } from '../features/preview/PreviewPanel';
import { bootstrap } from '../features/projects/session';
import { TimelinePanel } from '../features/timeline/TimelinePanel';
import { startAutosave } from '../store/autosave';
import { useProject } from '../store/projectStore';
import { ErrorBoundary } from './ErrorBoundary';
import { LeftPanel } from './LeftPanel';
import { Onboarding } from './Onboarding';
import { useGlobalShortcuts } from './shortcuts';
import { ShortcutSheet } from './ShortcutSheet';
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
    </div>
  );
}

/** Only mounted once the browser passed the capability check. */
function Editor() {
  const { t } = useTranslation();
  const project = useProject();
  useGlobalShortcuts();

  useEffect(() => {
    const stopAutosave = startAutosave();
    const stopMedia = startMediaWatcher();
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
      {project && (
        <>
          <main className="grid min-h-0 flex-1 grid-cols-[minmax(200px,20%)_minmax(0,1fr)_minmax(240px,22%)] gap-px bg-line">
            <ErrorBoundary area={t('panels.media')}>
              <LeftPanel project={project} />
            </ErrorBoundary>
            <ErrorBoundary area={t('panels.preview')}>
              <PreviewPanel project={project} />
            </ErrorBoundary>
            <ErrorBoundary area={t('panels.inspector')}>
              <Inspector project={project} />
            </ErrorBoundary>
          </main>
          <ErrorBoundary area={t('export.title')}>
            <ExportDialog project={project} />
          </ErrorBoundary>
          <div className="flex h-[34%] min-h-[180px] flex-col">
            <ErrorBoundary area={t('panels.timeline')}>
              <TimelinePanel project={project} />
            </ErrorBoundary>
          </div>
          <Onboarding project={project} />
        </>
      )}
      <ShortcutSheet />
    </>
  );
}
