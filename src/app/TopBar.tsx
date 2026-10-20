import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
    <header className="flex items-center gap-3 border-b border-line bg-surface-1 px-3 py-2">
      <span className="font-bold text-white">{t('app.title')}</span>
      <ProjectMenu />
      {project && <ProjectName key={project.id + project.name} name={project.name} />}
      <div className="flex gap-1">
        <Button
          onClick={undo}
          disabled={!canUndo}
          title={undoLabel ? t('edit.undoWith', { label: t(undoLabel) }) : t('edit.undo')}
        >
          {t('edit.undo')}
        </Button>
        <Button
          onClick={redo}
          disabled={!canRedo}
          title={redoLabel ? t('edit.redoWith', { label: t(redoLabel) }) : t('edit.redo')}
        >
          {t('edit.redo')}
        </Button>
      </div>
      <span
        className={`text-xs ${status === 'error' ? 'text-red-400' : 'text-neutral-400'}`}
        data-testid="save-status"
        data-status={status}
      >
        {t(`save.${status}`)}
      </span>
      <div className="ms-auto flex gap-2">
        <Button className="bg-accent! text-white" disabled={!project} onClick={() => useExport.setState({ open: true })} data-testid="open-export">
          ⤓ {t('export.open')}
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
      className="w-56 rounded border border-transparent bg-transparent px-2 py-1 text-sm hover:border-line focus:border-accent focus:bg-surface-2"
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
