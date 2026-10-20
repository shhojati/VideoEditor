import { useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../app/ui';
import { ACCEPT_ATTR } from '../../engine/decode/classify';
import { useProject } from '../../store/projectStore';
import { AssetCard } from './AssetCard';
import { dismissImport, importFiles, useMedia } from './mediaService';

export function MediaBin() {
  const { t } = useTranslation();
  const project = useProject();
  const imports = useMedia((s) => s.imports);
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const assets = Object.values(project?.assets ?? {});
  const hasFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');

  return (
    <>
      <div
        className={`flex min-h-full flex-col gap-2 p-2 ${dragging ? 'bg-accent/10 outline-2 -outline-offset-4 outline-accent outline-dashed' : ''}`}
        data-testid="media-bin"
        onDragEnter={(e) => hasFiles(e) && setDragging(true)}
        onDragOver={(e) => {
          if (!hasFiles(e)) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }}
        onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void importFiles([...e.dataTransfer.files]);
        }}
      >
        <Button onClick={() => inputRef.current?.click()}>{t('media.import')}</Button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={ACCEPT_ATTR}
          data-testid="media-input"
          onChange={(e) => {
            void importFiles([...(e.target.files ?? [])]);
            e.target.value = '';
          }}
        />

        {imports.map((job) => (
          <div key={job.id} className="rounded bg-surface-2 p-2 text-xs" data-testid="import-job">
            <div className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate" dir="auto">
                {job.name}
              </span>
              {job.stage === 'error' && (
                <button
                  className="text-neutral-400 hover:text-white"
                  aria-label={t('media.dismiss')}
                  onClick={() => dismissImport(job.id)}
                >
                  ✕
                </button>
              )}
            </div>
            {job.stage === 'error' ? (
              <div className="mt-1 text-red-300" role="alert">
                {t(`media.errors.${job.error!.code}`, { codec: job.error!.codec ?? '?' })}
              </div>
            ) : (
              <>
                <div className="mt-1 text-neutral-400">{t(`media.stage.${job.stage}`)}</div>
                <div className="mt-1 h-1 rounded bg-surface-3">
                  <div className="h-1 rounded bg-accent" style={{ width: `${Math.round(job.progress * 100)}%` }} />
                </div>
              </>
            )}
          </div>
        ))}

        {assets.length === 0 && imports.length === 0 ? (
          <div className="flex-1 rounded border border-dashed border-line p-6 text-center text-sm text-neutral-500">
            {t('media.empty')}
          </div>
        ) : (
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(130px,1fr))] gap-2" data-testid="asset-list">
            {assets.map((a) => (
              <AssetCard key={a.id} asset={a} />
            ))}
          </ul>
        )}
        <p className="mt-auto pt-2 text-[11px] text-neutral-500">{t('media.privacy')}</p>
      </div>
    </>
  );
}
