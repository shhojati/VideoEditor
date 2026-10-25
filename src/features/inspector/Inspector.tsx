import { useTranslation } from 'react-i18next';
import { Panel } from '../../app/ui';
import { formatDuration } from '../../lib/time';
import { ASPECT_PRESETS, aspectOf, type AspectPreset } from '../../model/factories';
import { PLATFORM_MAX_DURATION, PLATFORMS } from '../../model/platforms';
import type { Platform } from '../../model/types';
import { findClip } from '../../model/timeline';
import type { Project } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { useTimelineUi } from '../timeline/timelineUi';
import { ClipInspector } from './ClipInspector';
import { findCue } from '../../model/subtitles';
import { findTransition } from '../../model/transitions';
import { parseCutKey } from '../transitions/transitionActions';
import { TransitionInspector } from './TransitionInspector';
import { SubtitleStyleInspector } from '../subtitles/SubtitleStyleInspector';
import { CueTextField } from '../subtitles/CueTextField';
import { Section, SelectField } from './controls';
import { resetProjectSettings } from './resetActions';

const FPS_OPTIONS = [24, 25, 30, 50, 60];

/** One selected clip → its properties; otherwise the project settings. */
export function Inspector({ project }: { project: Project }) {
  const { t } = useTranslation();
  const selection = useTimelineUi((s) => s.selection);
  const existing = selection.filter((id) => findClip(project, id));
  const cueRef = selection.map((id) => findCue(project, id)).find(Boolean);
  const cueTrack = cueRef?.track;
  // A selected transition, or a selected cut without one.
  const cut = selection
    .map((id) => {
      const tr = findTransition(project, id)?.transition;
      return tr ? { fromId: tr.fromClipId, toId: tr.toClipId } : parseCutKey(id);
    })
    .find(Boolean);

  return (
    <Panel title={t('panels.inspector')}>
      {cut && !existing.length ? (
        <TransitionInspector key={cut.fromId + cut.toId} project={project} fromId={cut.fromId} toId={cut.toId} />
      ) : cueTrack && !existing.length ? (
        <>
          {cueRef && <CueTextField key={cueRef.cue.id} cueId={cueRef.cue.id} text={cueRef.cue.text} rtl={cueRef.track.rtl} />}
          <SubtitleStyleInspector key={cueTrack.id} project={project} trackId={cueTrack.id} />
        </>
      ) : existing.length === 1 ? (
        <ClipInspector key={existing[0]} project={project} clipId={existing[0]} />
      ) : (
        <>
          {existing.length > 1 && (
            <p className="border-b border-line px-3 py-2 text-xs text-muted md:px-4">
              {t('inspector.multi', { count: existing.length })}
            </p>
          )}
          <ProjectSettings project={project} />
        </>
      )}
    </Panel>
  );
}

function ProjectSettings({ project }: { project: Project }) {
  const { t } = useTranslation();
  const edit = useProjectStore((s) => s.edit);
  const { width, height, fps } = project.settings;
  return (
    <Section id="project" title={t('settings.title')} onReset={resetProjectSettings}>
      <SelectField
        label={t('settings.aspect')}
        value={aspectOf(project.settings) ?? ''}
        options={(Object.keys(ASPECT_PRESETS) as AspectPreset[]).map((k) => ({ value: k, label: k }))}
        onChange={(v) => edit('ops.aspect', (p) => Object.assign(p.settings, ASPECT_PRESETS[v as AspectPreset]))}
      />
      <SelectField
        label={t('settings.platform')}
        value={project.settings.platform ?? ''}
        options={[
          { value: '', label: t('newProject.none') },
          ...PLATFORMS.map((k) => ({ value: k, label: `${t(`platforms.${k}`)} (≤ ${formatDuration(PLATFORM_MAX_DURATION[k])})` })),
        ]}
        onChange={(v) =>
          edit('ops.platform', (p) => {
            if (v) p.settings.platform = v as Platform;
            else delete p.settings.platform;
          })
        }
      />
      <SelectField
        label={t('settings.fps')}
        value={fps}
        options={FPS_OPTIONS.map((f) => ({ value: f, label: String(f) }))}
        onChange={(v) => edit('ops.fps', (p) => void (p.settings.fps = v))}
      />
      <div className="flex flex-col gap-1 text-xs md:gap-1.5 md:text-sm">
        <span className="text-muted">{t('settings.size')}</span>
        <span dir="ltr" data-testid="canvas-size" className="rounded-md border border-line bg-surface-2 px-2.5 py-1 text-center text-neutral-200 md:py-1.5">
          {width}×{height}
        </span>
      </div>
    </Section>
  );
}
