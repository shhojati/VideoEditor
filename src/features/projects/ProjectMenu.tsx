import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../app/ui';
import { useProject } from '../../store/projectStore';
import { deleteProject, newProject, openProject, refreshList, useProjectList } from './session';

export function ProjectMenu() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = useProject();
  const { projects, loadError } = useProjectList();

  useEffect(() => {
    if (!open) return;
    void refreshList();
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const dateFmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: 'short', timeStyle: 'short' });

  return (
    <div className="relative" ref={ref}>
      <Button aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        {t('project.menu')} ▾
      </Button>
      {loadError && (
        <span className="ms-2 text-xs text-red-400">{t('project.loadError', { error: loadError })}</span>
      )}
      {open && (
        <div
          role="menu"
          className="absolute start-0 top-full z-20 mt-1 w-80 rounded border border-line bg-surface-2 p-1 shadow-xl"
        >
          <button
            role="menuitem"
            className="w-full rounded px-2 py-1.5 text-start text-sm hover:bg-surface-3"
            onClick={() => {
              setOpen(false);
              void newProject(t('app.untitled'));
            }}
          >
            {t('project.new')}
          </button>
          <div className="my-1 border-t border-line" />
          {projects.length === 0 && <div className="px-2 py-1.5 text-sm text-neutral-500">{t('project.empty')}</div>}
          <ul className="max-h-80 overflow-auto">
            {projects.map((p) => {
              const isCurrent = p.id === current?.id;
              return (
                <li key={p.id} className="group flex items-center gap-1 rounded hover:bg-surface-3">
                  <button
                    role="menuitem"
                    className="min-w-0 flex-1 px-2 py-1.5 text-start"
                    onClick={() => {
                      setOpen(false);
                      if (!isCurrent) void openProject(p.id);
                    }}
                  >
                    <div className="truncate text-sm">
                      {p.name}
                      {isCurrent && <span className="ms-2 text-xs text-accent">({t('project.current')})</span>}
                    </div>
                    <div className="text-xs text-neutral-500">{dateFmt.format(p.updatedAt)}</div>
                  </button>
                  <button
                    className="rounded px-2 py-1 text-xs text-red-300 opacity-0 group-hover:opacity-100 hover:bg-red-900/50 focus:opacity-100"
                    aria-label={`${t('project.delete')} ${p.name}`}
                    onClick={() => {
                      if (window.confirm(t('project.confirmDelete', { name: p.name })))
                        void deleteProject(p.id, t('app.untitled'));
                    }}
                  >
                    {t('project.delete')}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
