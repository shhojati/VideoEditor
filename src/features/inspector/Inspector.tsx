import { useTranslation } from 'react-i18next';
import { Panel } from '../../app/ui';
import { ASPECT_PRESETS, aspectOf, type AspectPreset } from '../../model/factories';
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
import { Section, SelectField } from './controls';

const FPS_OPTIONS = [24, 25, 30, 50, 60];

/** One selected clip → its properties; otherwise the project settings. */
export function Inspector({ project }: { project: Project }) {
  const { t } = useTranslation();
  const selection = useTimelineUi((s) => s.selection);
  const existing = selection.filter((id) => findClip(project, id));
  const cueTrack = selection.map((id) => findCue(project, id)?.track).find(Boolean);
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
        <SubtitleStyleInspector key={cueTrack.id} project={project} trackId={cueTrack.id} />
      ) : existing.length === 1 ? (
        <ClipInspector key={existing[0]} project={project} clipId={existing[0]} />
      ) : (
        <>
          {existing.length > 1 && (
            <p className="border-b border-line px-3 py-2 text-xs text-neutral-400">
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
    <Section title={t('settings.title')}>
      <SelectField
        label={t('settings.aspect')}
        value={aspectOf(project.settings) ?? ''}
        options={(Object.keys(ASPECT_PRESETS) as AspectPreset[]).map((k) => ({ value: k, label: k }))}
        onChange={(v) => edit('ops.aspect', (p) => Object.assign(p.settings, ASPECT_PRESETS[v as AspectPreset]))}
      />
      <SelectField
        label={t('settings.fps')}
        value={fps}
        options={FPS_OPTIONS.map((f) => ({ value: f, label: String(f) }))}
        onChange={(v) => edit('ops.fps', (p) => void (p.settings.fps = v))}
      />
      <div className="flex items-center gap-2 text-xs text-neutral-400">
        <span className="w-24">{t('settings.size')}</span>
        <span dir="ltr" data-testid="canvas-size">
          {width}×{height}
        </span>
      </div>
    </Section>
  );
}
