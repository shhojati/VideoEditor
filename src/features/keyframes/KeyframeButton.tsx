import { useTranslation } from 'react-i18next';
import { Button } from '../../app/ui';
import { findClip } from '../../model/timeline';
import type { Project } from '../../model/types';
import { useTransport } from '../../store/transport';
import { useTimelineUi } from '../timeline/timelineUi';
import { isInside, keyAtPlayhead, toggleKeyframe } from './keyframeService';

/** InShot's keyframe button in the timeline toolbar: ◆+ / ◆− for the selected clip at the playhead. */
export function KeyframeButton({ project }: { project: Project }) {
  const { t } = useTranslation();
  const selection = useTimelineUi((s) => s.selection);
  const time = useTransport((s) => s.time);
  const clip = selection.length === 1 ? findClip(project, selection[0])?.clip : undefined;
  const usable = !!clip && isInside(clip, time);
  const here = !!clip && usable && keyAtPlayhead(project, clip, time) >= 0;
  const label = t(here ? 'keyframes.remove' : 'keyframes.add');
  return (
    <Button
      className={`text-xs ${here ? 'text-sky-300!' : ''}`}
      disabled={!usable}
      onClick={() => clip && toggleKeyframe(clip.id)}
      title={`${usable ? label : t('keyframes.pick')} (K)`}
      aria-pressed={here}
      data-testid="btn-keyframe"
    >
      {here ? '◆−' : '◆+'} {t('keyframes.short')}
    </Button>
  );
}
