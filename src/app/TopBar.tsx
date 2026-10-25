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
import { AccountButton } from '../features/account/AccountDialogs';
import { ChevronDown, Globe, Keyboard, Redo2, Undo2, Upload } from 'lucide-react';
import { Icon } from './icons';
import { Logo } from './Logo';

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
    <header className="flex items-center gap-3 border-b border-line bg-surface-1 px-3 py-2 max-md:gap-1.5 max-md:px-2 max-md:py-1.5 md:h-[60px] md:gap-4 md:px-4">
      <span className="flex items-center gap-2.5 max-md:hidden md:me-2">
        <Logo className="h-8 w-8" />
        <span className="text-lg font-light tracking-[0.3em] text-neutral-100 uppercase">{t('app.title')}</span>
      </span>
      <ProjectMenu />
      {project && <ProjectName key={project.id + project.name} name={project.name} />}
      <div className="flex shrink-0 gap-1">
        {/* Arrows only; the label stays as the accessible name. */}
        <Button
          variant="ghost"
          onClick={undo}
          disabled={!canUndo}
          aria-label={t('edit.undo')}
          title={undoLabel ? t('edit.undoWith', { label: t(undoLabel) }) : t('edit.undo')}
        >
          <Icon icon={Undo2} />
        </Button>
        <Button
          variant="ghost"
          onClick={redo}
          disabled={!canRedo}
          aria-label={t('edit.redo')}
          title={redoLabel ? t('edit.redoWith', { label: t(redoLabel) }) : t('edit.redo')}
        >
          <Icon icon={Redo2} />
        </Button>
      </div>
      <span
        className={`flex items-center gap-2 text-xs md:text-sm ${status === 'error' ? 'text-red-400' : 'text-muted'}`}
        data-testid="save-status"
        data-status={status}
        title={t(`save.${status}`)}
      >
        {/* A status dot (green saved, amber pending, red failed); phones show only the dot. */}
        <span
          className={`inline-block h-2 w-2 rounded-full ${status === 'error' ? 'bg-red-500' : status === 'saved' ? 'bg-emerald-500' : 'bg-amber-400'}`}
          aria-hidden
        />
        <span className="max-md:hidden">{t(`save.${status}`)}</span>
      </span>
      {project && <LengthWarning project={project} />}
      <div className="ms-auto flex shrink-0 items-center gap-2 max-md:gap-1 md:gap-2.5">
        <AccountButton />
        <Button variant="primary" disabled={!project} onClick={() => useExport.setState({ open: true })} data-testid="open-export" aria-label={t('export.open')}>
          <Icon icon={Upload} />
          <span className="max-md:hidden">{t('export.open')}</span>
        </Button>
        <Button className="max-md:hidden" onClick={() => useShortcutSheet.setState({ open: true })} aria-label={t('shortcuts.open')} title={t('shortcuts.open') + ' (?)'}>
          <Icon icon={Keyboard} />
        </Button>
        <Button onClick={() => void i18n.changeLanguage(i18n.language === 'fa' ? 'en' : 'fa')} aria-label={t('lang.switch')} title={t('lang.switch')}>
          <Icon icon={Globe} />
          <span className="uppercase max-md:hidden">{i18n.language === 'fa' ? 'فا' : 'EN'}</span>
          <Icon icon={ChevronDown} size={14} className="max-md:hidden" />
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
      className="w-56 rounded-md border max-md:w-auto max-md:min-w-0 max-md:flex-1 border-transparent bg-transparent px-2 py-1 text-sm hover:border-line focus:border-accent focus:bg-surface-2"
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
