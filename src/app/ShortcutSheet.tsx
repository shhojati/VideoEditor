import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { create } from 'zustand';
import { Button } from './ui';

export const useShortcutSheet = create<{ open: boolean }>()(() => ({ open: false }));

/** Shown in the sheet; keep in sync with app/shortcuts.ts. */
export const SHORTCUTS: { keys: string; label: string }[] = [
  { keys: 'Space', label: 'playPause' },
  { keys: 'S', label: 'split' },
  { keys: 'Delete', label: 'delete' },
  { keys: 'Shift + Delete', label: 'rippleDelete' },
  { keys: '← / →', label: 'frame' },
  { keys: 'Shift + ← / →', label: 'tenFrames' },
  { keys: '↑ / ↓', label: 'editPoints' },
  { keys: 'Home / End', label: 'startEnd' },
  { keys: 'Ctrl + Z', label: 'undo' },
  { keys: 'Ctrl + Y / Ctrl + Shift + Z', label: 'redo' },
  { keys: 'Ctrl + C / Ctrl + V', label: 'copyPaste' },
  { keys: 'Ctrl + D', label: 'duplicate' },
  { keys: 'Ctrl + A', label: 'selectAll' },
  { keys: 'Ctrl + + / −', label: 'zoom' },
  { keys: 'Ctrl + wheel', label: 'zoomWheel' },
  { keys: 'Alt (drag)', label: 'noSnap' },
  { keys: 'Space + drag / middle drag', label: 'previewPan' },
  { keys: 'Shift (drag in preview)', label: 'previewShift' },
  { keys: 'Alt (resize in preview)', label: 'previewAlt' },
  { keys: 'G', label: 'maskPen' },
  { keys: 'K', label: 'keyframe' },
  { keys: '[ / ]', label: 'keyframeJump' },
  { keys: 'Esc', label: 'deselect' },
  { keys: '?', label: 'help' },
];

export function ShortcutSheet() {
  const { t } = useTranslation();
  const open = useShortcutSheet((s) => s.open);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && useShortcutSheet.setState({ open: false });
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title" onClick={() => useShortcutSheet.setState({ open: false })}>
      <div className="max-h-[85vh] w-[min(520px,94vw)] overflow-auto rounded-lg border border-line bg-surface-1 p-4 text-sm" onClick={(e) => e.stopPropagation()} data-testid="shortcut-sheet">
        <h2 id="shortcuts-title" className="mb-3 text-base font-semibold text-white">
          {t('shortcuts.title')}
        </h2>
        <table className="w-full text-xs">
          <tbody>
            {SHORTCUTS.map((s) => (
              <tr key={s.label} className="border-b border-line/60">
                <td className="py-1.5 text-neutral-300">{t(`shortcuts.items.${s.label}`)}</td>
                <td className="py-1.5 text-end" dir="ltr">
                  <kbd className="rounded bg-surface-3 px-1.5 py-0.5 font-mono">{s.keys}</kbd>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-neutral-400">{t('shortcuts.layoutNote')}</p>
        <div className="mt-3 text-end">
          <Button autoFocus onClick={() => useShortcutSheet.setState({ open: false })}>
            {t('export.close')}
          </Button>
        </div>
      </div>
    </div>
  );
}
