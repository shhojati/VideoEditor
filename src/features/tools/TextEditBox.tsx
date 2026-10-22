import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { detectRtl } from '../../engine/render/textLayout';
import { withMotion } from '../../engine/render/motion';
import { keyedClip } from '../../model/keyframes';
import { findClip } from '../../model/timeline';
import type { Project } from '../../model/types';
import { currentProject, useProjectStore } from '../../store/projectStore';
import { useTransport } from '../../store/transport';
import { usePreviewView } from '../preview/previewView';
import { stopEditingText, useTool } from './toolService';

/** Set a text clip's words; the direction follows them unless the user chose it (as in the inspector). */
function setContent(clipId: string, content: string, key: string) {
  useProjectStore.getState().edit(
    'ops.clipProp',
    (d) => {
      const ref = findClip(d, clipId);
      const t0 = ref?.clip.text;
      if (!t0 || ref.track.locked) return;
      if (!t0.content.trim() || t0.rtl === detectRtl(t0.content)) t0.rtl = detectRtl(content);
      t0.content = content;
    },
    { mergeKey: key, gesture: true },
  );
}

/** Finish typing; a new text left empty is taken back (its whole undo step). */
export function finishTextEdit() {
  const editing = useTool.getState().editingText;
  if (!editing) return;
  stopEditingText();
  const { history, undo } = useProjectStore.getState();
  const project = currentProject();
  const clip = project && findClip(project, editing.clipId)?.clip;
  if (editing.created && clip && !clip.text?.content.trim() && history?.past.at(-1)?.mergeKey === editing.key) undo();
}

/**
 * Typing a text on the preview (the type tool, or a double-click on a text): a box at the text's
 * place; what is typed shows on the picture behind it as it goes. Escape, Ctrl+Enter or a click
 * outside finishes.
 */
export function TextEditBox({ project }: { project: Project }) {
  const { t } = useTranslation();
  const editing = useTool((s) => s.editingText);
  const view = usePreviewView((s) => s.view);
  const time = useTransport((s) => s.time);
  const ref = useRef<HTMLTextAreaElement>(null);
  const clip = editing ? findClip(project, editing.clipId)?.clip : undefined;
  const gone = !!editing && !clip?.text;

  useEffect(() => {
    if (gone) stopEditingText();
  }, [gone]);
  useEffect(() => {
    if (!editing) return;
    const el = ref.current;
    el?.focus();
    el?.select();
  }, [editing]);

  if (!editing || !clip?.text) return null;
  const { width: W, height: H } = project.settings;
  const tr = withMotion(project, keyedClip(clip, time), time).transform;
  const x = view.ox + (W / 2 + tr.x * W) * view.k;
  const y = view.oy + (H / 2 + tr.y * H) * view.k;
  return (
    <textarea
      ref={ref}
      data-testid="text-edit-box"
      aria-label={t('tools.typeHere')}
      placeholder={t('tools.typeHere')}
      dir="auto"
      rows={Math.max(1, clip.text.content.split('\n').length)}
      className="absolute z-10 min-w-40 resize -translate-x-1/2 -translate-y-1/2 rounded border border-sky-400 bg-black/60 p-1.5 text-center text-sm text-white shadow-lg outline-none"
      style={{ left: x, top: y, fontFamily: `"${clip.text.fontFamily}", Vazirmatn` }}
      value={clip.text.content}
      onChange={(e) => setContent(clip.id, e.target.value, editing.key)}
      onKeyDown={(e) => {
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          e.preventDefault();
          e.stopPropagation();
          finishTextEdit();
        }
      }}
      onBlur={finishTextEdit}
    />
  );
}
