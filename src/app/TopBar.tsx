import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LengthWarning } from '../features/projects/LengthWarning';
import { ProjectMenu } from '../features/projects/ProjectMenu';
import { renameProject } from '../features/projects/session';
import { useSaveStatus } from '../store/autosave';
import {
  useCanRedo,
  useCanUndo,
  useProject,
  useProjectStore,
  useRedoLabel,
  useUndoLabel,
} from '../store/projectStore';
import { Button } from './ui';
import { useExport } from '../features/export/exportService';
import { useShortcutSheet } from './ShortcutSheet';

export function TopBar() {
  const { t, i18n } = useTranslation();
  const project = useProject();
  const { undo, redo } = useProjectStore.getState();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();
  const undoLabel = useUndoLabel();
  const redoLabel = useRedoLabel();
  const status = useSaveStatus((s) => s.status);

  return (
    <header className="flex items-center gap-3 border-b border-line bg-surface-1 px-3 py-2 max-md:gap-1.5 max-md:px-2 max-md:py-1.5">
      <span className="font-bold text-white max-md:hidden">{t('app.title')}</span>
      <ProjectMenu />
      {project && <ProjectName key={project.id + project.name} name={project.name} />}
      <div className="flex shrink-0 gap-1">
        {/* Phones show arrows only; the label stays as the accessible name. */}
        <Button
          onClick={undo}
          disabled={!canUndo}
          aria-label={t('edit.undo')}
          title={undoLabel ? t('edit.undoWith', { label: t(undoLabel) }) : t('edit.undo')}
        >
          <span className="max-md:hidden">{t('edit.undo')}</span>
          <span className="md:hidden" aria-hidden>
            ↶
          </span>
        </Button>
        <Button
          onClick={redo}
          disabled={!canRedo}
          aria-label={t('edit.redo')}
          title={redoLabel ? t('edit.redoWith', { label: t(redoLabel) }) : t('edit.redo')}
        >
          <span className="max-md:hidden">{t('edit.redo')}</span>
          <span className="md:hidden" aria-hidden>
            ↷
          </span>
        </Button>
      </div>
      <span
        className={`text-xs ${status === 'error' ? 'text-red-400' : 'text-neutral-400'}`}
        data-testid="save-status"
        data-status={status}
        title={t(`save.${status}`)}
      >
        <span className="max-md:hidden">{t(`save.${status}`)}</span>
        {/* Phones: a status dot (green saved, amber pending, red failed). */}
        <span
          className={`inline-block h-2 w-2 rounded-full md:hidden ${status === 'error' ? 'bg-red-500' : status === 'saved' ? 'bg-emerald-500' : 'bg-amber-400'}`}
          aria-hidden
        />
      </span>
      {project && <LengthWarning project={project} />}
      <div className="ms-auto flex shrink-0 gap-2 max-md:gap-1">
        <Button className="bg-accent! text-white" disabled={!project} onClick={() => useExport.setState({ open: true })} data-testid="open-export" aria-label={t('export.open')}>
          ⤓<span className="max-md:hidden"> {t('export.open')}</span>
        </Button>
        <Button className="max-md:hidden" onClick={() => useShortcutSheet.setState({ open: true })} aria-label={t('shortcuts.open')} title={t('shortcuts.open') + ' (?)'}>
          ⌨
        </Button>
        <Button onClick={() => void i18n.changeLanguage(i18n.language === 'fa' ? 'en' : 'fa')}>
          {t('lang.switch')}
        </Button>
      </div>
    </header>
  );
}

/** Inline rename: commits on blur / Enter, reverts on Escape. */
function ProjectName({ name }: { name: string }) {
  const { t } = useTranslation();
  // Parent keys this component by name, so undo/redo of a rename remounts it with the new value.
  const [value, setValue] = useState(name);
  return (
    <input
      aria-label={t('project.rename')}
      dir="auto"
      className="w-56 rounded border max-md:w-auto max-md:min-w-0 max-md:flex-1 border-transparent bg-transparent px-2 py-1 text-sm hover:border-line focus:border-accent focus:bg-surface-2"
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => (value.trim() ? renameProject(value) : setValue(name))}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          setValue(name);
          requestAnimationFrame(() => (e.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}
