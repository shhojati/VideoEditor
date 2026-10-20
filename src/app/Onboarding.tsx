import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { importFiles } from '../features/media-bin/mediaService';
import { renameProject } from '../features/projects/session';
import { useSubtitlesUi } from '../features/subtitles/subtitlesUi';
import { generateSampleVideo } from '../lib/sample';
import { createSubtitleTrack, newId } from '../model/factories';
import { addTextClip, createClip, insertClip } from '../model/timeline';
import type { Project } from '../model/types';
import { useProjectStore } from '../store/projectStore';
import { useShortcutSheet } from './ShortcutSheet';
import { Button } from './ui';

const HIDE_KEY = 'onboarding-hidden';

function readHidden() {
  try {
    return localStorage.getItem(HIDE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Fills the (empty) current project with a sample: generated video, a Persian title and two subtitles. */
async function loadSample(t: (k: string) => string) {
  renameProject(t('onboarding.sampleName'));
  const file = await generateSampleVideo();
  await importFiles([file]);
  const asset = Object.values(useProjectStore.getState().history!.present.assets)[0];
  if (!asset) return;
  useProjectStore.getState().edit('ops.importMedia', (p) => {
    insertClip(p.tracks.find((tr) => tr.kind === 'video')!, createClip(asset, 0));
    addTextClip(p, 0.5, {
      content: t('onboarding.sampleTitle'),
      fontFamily: 'Lalezar',
      fontSize: 110,
      fontWeight: 400,
      color: '#ffffff',
      strokeColor: '#1b1f3b',
      strokeWidth: 8,
      align: 'center',
      rtl: true,
      fadeIn: 0.4,
      fadeOut: 0.4,
    });
    const subs = createSubtitleTrack('fa');
    subs.cues = [
      { id: newId(), start: 1, end: 3.5, text: t('onboarding.sampleCue1') },
      { id: newId(), start: 4, end: 7, text: t('onboarding.sampleCue2') },
    ];
    p.subtitleTracks.push(subs);
  });
}

/** First-run guide over an empty project. */
export function Onboarding({ project }: { project: Project }) {
  const { t } = useTranslation();
  const [hidden, setHidden] = useState(readHidden);
  const [loading, setLoading] = useState(false);
  const empty = !Object.keys(project.assets).length && !project.subtitleTracks.length && project.tracks.every((tr) => !tr.clips.length);
  if (hidden || !empty) return null;

  const hide = () => {
    setHidden(true);
    try {
      localStorage.setItem(HIDE_KEY, '1');
    } catch {
      // not remembered
    }
  };

  return (
    <div className="pointer-events-none fixed inset-0 z-40 flex items-center justify-center p-4">
      <section className="pointer-events-auto w-[min(460px,94vw)] space-y-3 rounded-lg border border-line bg-surface-1/95 p-5 text-sm shadow-2xl backdrop-blur" aria-labelledby="welcome-title" data-testid="onboarding">
        <h2 id="welcome-title" className="text-base font-semibold text-white">
          {t('onboarding.title')}
        </h2>
        <ol className="list-decimal space-y-1 ps-5 text-neutral-300">
          {(['step1', 'step2', 'step3', 'step4'] as const).map((s) => (
            <li key={s}>{t(`onboarding.${s}`)}</li>
          ))}
        </ol>
        <p className="text-xs text-neutral-400">{t('media.privacy')}</p>
        <div className="flex flex-wrap gap-2">
          <Button
            className="bg-accent! text-white"
            disabled={loading}
            data-testid="load-sample"
            onClick={async () => {
              setLoading(true);
              try {
                await loadSample(t);
                useSubtitlesUi.setState({ tab: 'media' });
              } finally {
                setLoading(false);
              }
            }}
          >
            {loading ? t('onboarding.loading') : t('onboarding.sample')}
          </Button>
          <Button onClick={() => useShortcutSheet.setState({ open: true })}>{t('shortcuts.open')}</Button>
          <Button className="ms-auto" onClick={hide}>
            {t('onboarding.hide')}
          </Button>
        </div>
      </section>
    </div>
  );
}
