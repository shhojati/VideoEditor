import { useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SHAPE_KINDS } from '../../model/overlays';
import { Brush, Eraser, Hand, MousePointer2, PenTool, Stamp, Type } from 'lucide-react';
import { Icon, type LucideIcon } from '../../app/icons';
import { SHAPE_LINE_ICONS } from '../shapes/shapesUi';
import { BrushOptions } from '../paint/BrushOptions';
import { setTool, useTool, type Tool } from './toolService';

const TOOLS: { tool: Tool; key: string; icon?: LucideIcon }[] = [
  { tool: 'select', key: 'V', icon: MousePointer2 },
  { tool: 'hand', key: 'H', icon: Hand },
  { tool: 'pen', key: 'G', icon: PenTool },
  { tool: 'shape', key: 'Q' },
  { tool: 'text', key: 'T', icon: Type },
  { tool: 'brush', key: 'B', icon: Brush },
  { tool: 'clone', key: 'Shift+B', icon: Stamp },
  { tool: 'eraser', key: 'E', icon: Eraser },
];

/** A tool button's height plus the gap below it (px). */
const ROW = 30;

const btn = 'flex h-7 w-7 items-center justify-center rounded-md text-sm leading-none';

/**
 * The preview's tool strip (top-left); beside it, the shape tool's shapes or the brush settings,
 * until the tool has been used (a shape drawn goes back to Select; a stroke folds the brush settings).
 */
export function ToolBar() {
  const { t } = useTranslation();
  const tool = useTool((s) => s.tool);
  const kind = useTool((s) => s.shapeKind);
  const optionsOpen = useTool((s) => s.optionsOpen);
  // As many rows as the preview's height holds; the rest wrap into a second column.
  const boxRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(TOOLS.length);
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setRows(Math.max(1, Math.min(TOOLS.length, Math.floor((el.clientHeight - 4) / ROW)))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    // Spans the viewport's height so a short preview wraps the tools into a second column; only the
    // bars themselves take clicks.
    <div ref={boxRef} data-preview-ui className="pointer-events-none absolute start-2 top-2 bottom-2 z-10 flex items-start gap-1 *:pointer-events-auto" dir="ltr">
      <div role="toolbar" aria-label={t('tools.title')} aria-orientation="vertical" className="grid grid-flow-col gap-0.5 rounded-lg border border-line bg-surface-2/95 p-0.5 shadow"
        style={{ gridTemplateRows: `repeat(${rows}, 28px)` }}
      >
        {TOOLS.map((x) => (
          <button
            key={x.tool}
            type="button"
            data-testid={`tool-${x.tool}`}
            aria-pressed={tool === x.tool}
            title={`${t(`tools.${x.tool}`)} (${x.key})`}
            aria-label={t(`tools.${x.tool}`)}
            className={`${btn} ${tool === x.tool ? 'bg-accent/90 text-on-accent' : 'text-neutral-300 hover:bg-surface-3 hover:text-white'}`}
            onClick={() => setTool(x.tool)}
          >
            <Icon icon={x.icon ?? SHAPE_LINE_ICONS[kind]} size={16} />
          </button>
        ))}
      </div>
      {tool === 'shape' && optionsOpen && (
        <div role="radiogroup" aria-label={t('tools.shapeKind')} className="mt-[92px] flex gap-0.5 rounded-lg border border-line bg-surface-2/95 p-0.5 shadow">
          {SHAPE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              data-testid={`tool-shape-${k}`}
              title={t(`shapes.${k}`)}
              aria-label={t(`shapes.${k}`)}
              className={`${btn} ${kind === k ? 'bg-accent/90 text-on-accent' : 'text-neutral-200 hover:bg-surface-3'}`}
              onClick={() => useTool.setState({ shapeKind: k })}
            >
              <Icon icon={SHAPE_LINE_ICONS[k]} size={16} />
            </button>
          ))}
        </div>
      )}
      {(tool === 'brush' || tool === 'eraser' || tool === 'clone') && optionsOpen && <BrushOptions />}
    </div>
  );
}
