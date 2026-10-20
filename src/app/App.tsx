import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { bootstrap } from '../features/projects/session';
import { MediaBin } from '../features/media-bin/MediaBin';
import { startMediaWatcher } from '../features/media-bin/mediaService';
import { playbackEngine } from '../engine/playback/engine';
import { PreviewPanel } from '../features/preview/PreviewPanel';
import { Inspector } from '../features/inspector/Inspector';
import { TimelinePanel } from '../features/timeline/TimelinePanel';
import { startAutosave } from '../store/autosave';
import { useProject } from '../store/projectStore';
import { TopBar } from './TopBar';
import { BrowserNotice } from './BrowserNotice';
import { useGlobalShortcuts } from './shortcuts';

export function App() {
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
    <div className="flex h-full flex-col">
      <TopBar />
      <BrowserNotice />
      {project && (
        <>
          <main className="grid min-h-0 flex-1 grid-cols-[minmax(200px,20%)_minmax(0,1fr)_minmax(240px,22%)] gap-px bg-line">
            <MediaBin />
            <PreviewPanel project={project} />
            <Inspector project={project} />
          </main>
          <div className="flex h-[34%] min-h-[180px] flex-col">
            <TimelinePanel project={project} />
          </div>
        </>
      )}
    </div>
  );
}
