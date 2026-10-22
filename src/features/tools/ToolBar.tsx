import { useTranslation } from 'react-i18next';
import { SHAPE_KINDS } from '../../model/overlays';
import { SHAPE_ICONS } from '../shapes/shapesUi';
import { BrushOptions } from '../paint/BrushOptions';
import { setTool, useTool, type Tool } from './toolService';

const TOOLS: { tool: Tool; key: string; icon?: string }[] = [
  { tool: 'select', key: 'V', icon: '➤' },
  { tool: 'hand', key: 'H', icon: '✋' },
  { tool: 'pen', key: 'G', icon: '✒' },
  { tool: 'shape', key: 'Q' },
  { tool: 'text', key: 'T', icon: 'T' },
  { tool: 'brush', key: 'B', icon: '🖌' },
  { tool: 'clone', key: 'Shift+B', icon: '⧉' },
  { tool: 'eraser', key: 'E', icon: '⌫' },
];

const btn = 'flex h-7 w-7 items-center justify-center rounded text-sm leading-none';

/** The preview's tool strip (top-left); beside it, the shape tool's shapes or the brush settings. */
export function ToolBar() {
  const { t } = useTranslation();
  const tool = useTool((s) => s.tool);
  const kind = useTool((s) => s.shapeKind);
  return (
    <div data-preview-ui className="absolute start-2 top-2 z-10 flex items-start gap-1" dir="ltr">
      <div role="toolbar" aria-label={t('tools.title')} aria-orientation="vertical" className="flex flex-col gap-0.5 rounded border border-line bg-surface-2/90 p-0.5 shadow">
        {TOOLS.map((x) => (
          <button
            key={x.tool}
            type="button"
            data-testid={`tool-${x.tool}`}
            aria-pressed={tool === x.tool}
            title={`${t(`tools.${x.tool}`)} (${x.key})`}
            aria-label={t(`tools.${x.tool}`)}
            className={`${btn} ${tool === x.tool ? 'bg-accent text-white' : 'text-neutral-200 hover:bg-surface-3'} ${x.tool === 'text' ? 'font-serif font-bold' : ''}`}
            onClick={() => setTool(x.tool)}
          >
            {x.icon ?? SHAPE_ICONS[kind]}
          </button>
        ))}
      </div>
      {tool === 'shape' && (
        <div role="radiogroup" aria-label={t('tools.shapeKind')} className="mt-[92px] flex gap-0.5 rounded border border-line bg-surface-2/90 p-0.5 shadow">
          {SHAPE_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={kind === k}
              data-testid={`tool-shape-${k}`}
              title={t(`shapes.${k}`)}
              aria-label={t(`shapes.${k}`)}
              className={`${btn} ${kind === k ? 'bg-accent/70 text-white' : 'text-neutral-200 hover:bg-surface-3'}`}
              onClick={() => useTool.setState({ shapeKind: k })}
            >
              {SHAPE_ICONS[k]}
            </button>
          ))}
        </div>
      )}
      {(tool === 'brush' || tool === 'eraser' || tool === 'clone') && <BrushOptions />}
    </div>
  );
}
