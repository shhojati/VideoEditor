import { useTranslation } from 'react-i18next';
import { Panel } from '../../app/ui';
import { ASPECT_PRESETS, aspectOf, type AspectPreset } from '../../model/factories';
import type { Project } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';

const FPS_OPTIONS = [24, 25, 30, 50, 60];

/** Clip properties come in Phase 5; for now: project settings (undoable). */
export function Inspector({ project }: { project: Project }) {
  const { t } = useTranslation();
  const edit = useProjectStore((s) => s.edit);
  const { width, height, fps } = project.settings;

  return (
    <Panel title={t('panels.inspector')}>
      <div className="space-y-3 p-3 text-sm">
        <h3 className="font-medium text-neutral-300">{t('settings.title')}</h3>
        <label className="flex items-center justify-between gap-2">
          <span>{t('settings.aspect')}</span>
          <select
            className="rounded bg-surface-3 px-2 py-1"
            value={aspectOf(project.settings) ?? ''}
            onChange={(e) =>
              edit('ops.aspect', (p) => Object.assign(p.settings, ASPECT_PRESETS[e.target.value as AspectPreset]))
            }
          >
            {(Object.keys(ASPECT_PRESETS) as AspectPreset[]).map((k) => (
              <option key={k} value={k} dir="ltr">
                {k}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>{t('settings.fps')}</span>
          <select
            className="rounded bg-surface-3 px-2 py-1"
            value={fps}
            onChange={(e) =>
              edit('ops.fps', (p) => {
                p.settings.fps = Number(e.target.value);
              })
            }
          >
            {FPS_OPTIONS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <div className="flex items-center justify-between gap-2 text-neutral-400">
          <span>{t('settings.size')}</span>
          <span dir="ltr" data-testid="canvas-size">
            {width}×{height}
          </span>
        </div>
      </div>
    </Panel>
  );
}
