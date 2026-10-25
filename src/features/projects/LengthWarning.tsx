import { TriangleAlert } from 'lucide-react';
import { Icon } from '../../app/icons';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { showToast } from '../../app/toasts';
import { formatDuration } from '../../lib/time';
import { maxDurationOf, overLimitBy } from '../../model/platforms';
import { timelineDuration } from '../../model/timeline';
import type { Project } from '../../model/types';

/** The sentence used wherever the editor warns that the video is too long for its platform. */
export function lengthWarningText(project: Project, t: TFunction) {
  return t('length.over', {
    duration: formatDuration(timelineDuration(project)),
    platform: t(`platforms.${project.settings.platform}`),
    max: formatDuration(maxDurationOf(project) ?? 0),
  });
}

/**
 * Shown next to the save status while the timeline is longer than the platform allows. Autosave keeps
 * the work safe either way; this only warns, with a toast when an edit first crosses the limit.
 */
export function LengthWarning({ project }: { project: Project }) {
  const { t } = useTranslation();
  const over = overLimitBy(project) > 0;
  const last = useRef<{ id: string; over: boolean } | null>(null);

  useEffect(() => {
    // Opening a project that is already too long shows the badge only, not a toast.
    if (last.current?.id === project.id && !last.current.over && over)
      showToast(lengthWarningText(project, t));
    last.current = { id: project.id, over };
  }, [project, over, t]);

  if (!over) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-md bg-amber-900/60 px-2 py-0.5 text-xs text-amber-200"
      role="status"
      data-testid="length-warning"
      title={lengthWarningText(project, t)}
    >
      <Icon icon={TriangleAlert} size={14} />
      <span className="max-md:hidden" dir="ltr">
        {' '}
        {formatDuration(timelineDuration(project))} / {formatDuration(maxDurationOf(project) ?? 0)}
      </span>
    </span>
  );
}
