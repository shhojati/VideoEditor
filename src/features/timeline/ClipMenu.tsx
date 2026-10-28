// Right-click (long press on touch) menu for clips, on the timeline and the preview: Arrange,
// Group / Ungroup, and SVG path copy / paste for shapes.
import { BringToFront, ClipboardCopy, ClipboardPaste, Group, MoveDown, MoveUp, SendToBack, Ungroup, type LucideIcon } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { create } from 'zustand';
import { Icon } from '../../app/icons';
import { showToast } from '../../app/toasts';
import { toPathData } from '../../lib/svgPath';
import { findClip, type ArrangeAction } from '../../model/timeline';
import type { ID } from '../../model/types';
import { currentProject } from '../../store/projectStore';
import { arrangeSelection, pasteSvgPath } from './actions';
import { groupSelection, ungroupSelection } from './compoundActions';
import { select, useTimelineUi } from './timelineUi';

const useClipMenu = create<{ at: { x: number; y: number } | null }>()(() => ({ at: null }));

const MENU_W = 220;
const MENU_H = 320;

/** Open the menu at the pointer for this clip (selecting it first unless it is already selected). */
export function openClipMenu(e: { clientX: number; clientY: number; preventDefault(): void }, clipId: ID) {
  e.preventDefault();
  if (!useTimelineUi.getState().selection.includes(clipId)) select([clipId]);
  useClipMenu.setState({ at: { x: e.clientX, y: e.clientY } });
}

const close = () => useClipMenu.setState({ at: null });

async function copyPathData(clipId: ID) {
  const s = findClip(currentProject()!, clipId)?.clip.shape;
  if (!s?.path) return;
  try {
    await navigator.clipboard.writeText(toPathData(s.path.value, !!s.closed));
    showToast(i18n.t('shapes.pathCopied'));
  } catch {
    showToast(i18n.t('shapes.clipboardBlocked'));
  }
}

async function pastePathData() {
  let text: string | null;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    // Clipboard reading refused: type or paste it in instead.
    text = window.prompt(i18n.t('shapes.replacePathPrompt'));
  }
  if (!text) return;
  const err = pasteSvgPath(text);
  if (err) showToast(i18n.t('shapes.badPath', { error: err }));
}

const ARRANGE: [ArrangeAction, LucideIcon, string][] = [
  ['bringToFront', BringToFront, 'Ctrl+Shift+]'],
  ['forward', MoveUp, 'Ctrl+]'],
  ['backward', MoveDown, 'Ctrl+['],
  ['sendToBack', SendToBack, 'Ctrl+Shift+['],
];

export function ClipMenu() {
  const { t } = useTranslation();
  const at = useClipMenu((s) => s.at);
  const selection = useTimelineUi((s) => s.selection);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!at) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && close();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('blur', close);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('blur', close);
    };
  }, [at]);

  const p = currentProject();
  if (!at || !p) return null;
  const refs = selection.map((id) => findClip(p, id)).filter((r) => !!r);
  const visual = refs.some((r) => r.track.kind !== 'audio' && !r.track.locked);
  const compound = refs.some((r) => r.clip.sequenceId);
  const pathClip = refs.length === 1 && refs[0].clip.shape?.kind === 'path' && refs[0].clip.shape.path ? refs[0].clip.id : undefined;

  const item = (key: string, icon: LucideIcon, label: string, run: () => void, opts: { keys?: string; disabled?: boolean } = {}) => (
    <button
      key={key}
      role="menuitem"
      data-testid={`clip-menu-${key}`}
      disabled={opts.disabled}
      className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-start text-xs hover:bg-surface-3 disabled:opacity-40 disabled:hover:bg-transparent"
      onClick={() => {
        close();
        run();
      }}
    >
      <Icon icon={icon} size={16} />
      <span className="flex-1">{label}</span>
      {opts.keys && (
        <kbd className="font-mono text-[10px] text-neutral-400" dir="ltr">
          {opts.keys}
        </kbd>
      )}
    </button>
  );

  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={t('clipMenu.title')}
      data-testid="clip-menu"
      style={{ left: Math.max(4, Math.min(at.x, window.innerWidth - MENU_W - 4)), top: Math.max(4, Math.min(at.y, window.innerHeight - MENU_H - 4)), width: MENU_W }}
      className="fixed z-50 rounded border border-line bg-surface-2 p-1 shadow-xl"
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="px-2 pt-1 pb-0.5 text-[10px] text-neutral-400 uppercase">{t('clipMenu.arrange')}</div>
      {ARRANGE.map(([action, icon, keys]) => item(action, icon, t(`clipMenu.${action}`), () => arrangeSelection(action), { keys, disabled: !visual }))}
      <div className="my-1 border-t border-line/60" />
      {item('group', Group, t('clipMenu.group'), groupSelection, { keys: 'Ctrl+G', disabled: refs.length < 2 })}
      {item('ungroup', Ungroup, t('clipMenu.ungroup'), ungroupSelection, { keys: 'Ctrl+Shift+G', disabled: !compound })}
      <div className="my-1 border-t border-line/60" />
      {item('copyPath', ClipboardCopy, t('shapes.copyPath'), () => pathClip && void copyPathData(pathClip), { disabled: !pathClip })}
      {item('pastePath', ClipboardPaste, t('shapes.pastePath'), () => void pastePathData())}
    </div>,
    document.body,
  );
}
