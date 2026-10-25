import { Flag, Group, X } from 'lucide-react';
import { Icon } from '../../app/icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../app/ui';
import { formatDuration } from '../../lib/time';
import type { Project } from '../../model/types';
import { useProjectStore, useRootProject } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { removeMarker } from './beatActions';
import { editMarker, exitTo, makeCompoundFromSelection, MARKER_COLORS } from './compoundActions';
import { useTimelineUi } from './timelineUi';

/** Where you are: the main timeline › compound › compound (click to go back out). */
export function Breadcrumb() {
  const { t } = useTranslation();
  const path = useProjectStore((s) => s.editPath);
  const root = useRootProject();
  if (!path.length || !root) return null;
  return (
    <nav className="flex items-center gap-1 border-b border-teal-700/60 bg-teal-950/60 px-2 py-1 text-xs" aria-label={t('compound.path')} data-testid="compound-path">
      <button className="text-teal-200 underline hover:text-white" onClick={() => exitTo(0)} data-testid="compound-exit">
        {t('compound.main')}
      </button>
      {path.map((step, i) => (
        <span key={step.sequenceId} className="flex items-center gap-1">
          <span className="text-neutral-500">›</span>
          {i < path.length - 1 ? (
            <button className="text-teal-200 underline hover:text-white" onClick={() => exitTo(i + 1)}>
              {root.sequences?.[step.sequenceId]?.name}
            </button>
          ) : (
            <span className="font-medium text-white">▣ {root.sequences?.[step.sequenceId]?.name}</span>
          )}
        </span>
      ))}
      <span className="ms-auto text-neutral-400">{t('compound.inside')}</span>
    </nav>
  );
}

/** Toolbar: make a compound clip from the selection. */
export function MakeCompoundButton() {
  const { t } = useTranslation();
  const count = useTimelineUi((s) => s.selection.length);
  return (
    <Button className="text-xs" disabled={count < 2} onClick={makeCompoundFromSelection} title={t('compound.makeHint')} data-testid="make-compound">
      <Icon icon={Group} size={16} />
      {t('compound.make')}
    </Button>
  );
}

/** Toolbar: the markers, to name, colour, jump to or remove. */
export function MarkersMenu({ project }: { project: Project }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const markers = project.markers ?? [];
  if (!markers.length) return null;
  return (
    <span className="relative">
      <Button className="text-xs" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="markers-menu" title={t('markers.hint')}>
        <Icon icon={Flag} size={16} />
        {markers.length}
      </Button>
      {open && (
        <div className="absolute top-full z-40 mt-1 w-72 space-y-1 rounded border border-line bg-surface-1 p-2 shadow-xl" data-testid="markers-list">
          {markers.map((m) => (
            <div key={m.id} className="flex items-center gap-1">
              <button className="font-mono text-neutral-300 hover:text-white" dir="ltr" onClick={() => useTransport.getState().seek(m.t)} title={t('markers.jump')}>
                {formatDuration(Math.floor(m.t))}.{String(Math.floor((m.t % 1) * 10))}
              </button>
              <input
                className="min-w-0 flex-1 rounded bg-surface-3 px-1 py-0.5"
                placeholder={t('markers.label')}
                aria-label={t('markers.label')}
                value={m.label ?? ''}
                onChange={(e) => editMarker(m.id, { label: e.target.value })}
              />
              {MARKER_COLORS.map((c) => (
                <button
                  key={c}
                  className={`h-4 w-4 rounded-full ${(m.color ?? MARKER_COLORS[0]) === c ? 'ring-2 ring-white' : ''}`}
                  style={{ background: c }}
                  aria-label={t('markers.color')}
                  onClick={() => editMarker(m.id, { color: c })}
                />
              ))}
              <button className="px-1 text-neutral-400 hover:text-white" aria-label={t('markers.remove')} onClick={() => removeMarker(m.id)}>
                <Icon icon={X} size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </span>
  );
}
