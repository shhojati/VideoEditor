import { useTranslation } from 'react-i18next';
import { Panel } from '../../app/ui';
import type { Project } from '../../model/types';

/** Canvas stage that letterboxes to the project's aspect ratio. renderFrame() arrives in Phase 4. */
export function PreviewPanel({ project }: { project: Project }) {
  const { t } = useTranslation();
  const { width, height } = project.settings;
  return (
    <Panel title={t('panels.preview')}>
      <div dir="ltr" className="flex h-full items-center justify-center bg-surface-0 p-4">
        <canvas
          width={width}
          height={height}
          data-testid="preview-canvas"
          className="max-h-full max-w-full bg-black shadow-lg"
          style={{ aspectRatio: `${width} / ${height}` }}
        />
      </div>
    </Panel>
  );
}
