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

const btn = 'flex h-7 w-7 items-center justify-center rounded-md text-sm leading-none md:h-9 md:w-9';

/**
 * The preview's tool strip (top-left); beside it, the shape tool's shapes or the brush settings,
 * until the tool has been used (a shape drawn goes back to Select; a stroke folds the brush settings).
 */
export function ToolBar() {
  const { t } = useTranslation();
  const tool = useTool((s) => s.tool);
  const kind = useTool((s) => s.shapeKind);
  const optionsOpen = useTool((s) => s.optionsOpen);
  return (
    <div data-preview-ui className="absolute start-2 top-2 z-10 flex items-start gap-1" dir="ltr">
      <div role="toolbar" aria-label={t('tools.title')} aria-orientation="vertical" className="flex flex-col gap-0.5 rounded-lg border border-line bg-surface-2/95 p-0.5 shadow md:gap-1 md:p-1">
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
            <Icon icon={x.icon ?? SHAPE_LINE_ICONS[kind]} />
          </button>
        ))}
      </div>
      {tool === 'shape' && optionsOpen && (
        <div role="radiogroup" aria-label={t('tools.shapeKind')} className="mt-[92px] flex gap-0.5 rounded-lg border border-line bg-surface-2/95 p-0.5 shadow md:mt-[124px] md:p-1">
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
              <Icon icon={SHAPE_LINE_ICONS[k]} />
            </button>
          ))}
        </div>
      )}
      {(tool === 'brush' || tool === 'eraser' || tool === 'clone') && optionsOpen && <BrushOptions />}
    </div>
  );
}
