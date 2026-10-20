import { useTranslation } from 'react-i18next';
import { Panel } from '../../app/ui';

/** Placeholder until Phase 2 (import + thumbnails). */
export function MediaBin() {
  const { t } = useTranslation();
  return (
    <Panel title={t('panels.media')}>
      <div className="m-3 rounded border border-dashed border-line p-6 text-center text-sm text-neutral-500">
        {t('panels.mediaEmpty')}
      </div>
    </Panel>
  );
}
