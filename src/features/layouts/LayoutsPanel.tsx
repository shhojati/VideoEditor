import { useTranslation } from 'react-i18next';
import { LAYOUT_CATEGORIES, LAYOUTS, layoutClips, type Layout } from '../../model/layouts';
import { useProject } from '../../store/projectStore';
import { useTimelineUi } from '../timeline/timelineUi';
import { applyLayoutToSelection } from './layoutActions';

const COLORS = ['#3b82f6', '#f59e0b', '#10b981', '#ec4899'];

/** A layout's cells as a small picture: cell 1 in blue, 2 in amber… */
function Thumb({ layout, width, height }: { layout: Layout; width: number; height: number }) {
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-full w-full" aria-hidden>
      <rect width={width} height={height} fill="#111" />
      {layout.cells(width, height).map((c, i) => {
        const [x, y, w, h] = [c.x * width, c.y * height, c.w * width, c.h * height];
        const fill = COLORS[i % COLORS.length];
        const stroke = c.border ? { stroke: '#fff', strokeWidth: Math.min(width, height) * 0.012 } : {};
        if (c.shape === 'circle') return <ellipse key={i} cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} fill={fill} {...stroke} />;
        if (c.shape) return <polygon key={i} points={c.shape.polygon.map(([px, py]) => `${x + px * w},${y + py * h}`).join(' ')} fill={fill} {...stroke} />;
        return <rect key={i} x={x} y={y} width={w} height={h} rx={c.radius ?? 0} fill={fill} {...stroke} />;
      })}
    </svg>
  );
}

/** Picture-in-picture, split screens and creative layouts for the selected clips. */
export function LayoutsPanel() {
  const { t } = useTranslation();
  const project = useProject();
  const selection = useTimelineUi((s) => s.selection);
  if (!project) return null;
  const { width, height } = project.settings;
  const usable = layoutClips(project, selection).length;
  return (
    <div className="space-y-3 p-2 text-xs" data-testid="layouts-panel">
      <p className="text-neutral-400">{t('layouts.hint')}</p>
      <p className={usable ? 'text-neutral-200' : 'text-amber-300'} data-testid="layouts-selected">
        {usable ? t('layouts.selected', { count: usable }) : t('layouts.none')}
      </p>
      {LAYOUT_CATEGORIES.map((category) => (
        <section key={category}>
          <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-neutral-400 uppercase">{t(`layouts.categories.${category}`)}</h3>
          <div className="grid grid-cols-3 gap-1.5">
            {LAYOUTS.filter((l) => l.category === category).map((l) => (
              <button
                key={l.id}
                data-testid="layout-item"
                data-layout={l.id}
                disabled={!usable}
                title={t('layouts.itemHint', { count: l.cells(width, height).length })}
                className="flex flex-col overflow-hidden rounded bg-surface-2 text-start enabled:hover:ring-1 enabled:hover:ring-accent disabled:opacity-50"
                onClick={() => applyLayoutToSelection(l)}
              >
                <div className="w-full" style={{ aspectRatio: `${width} / ${height}` }}>
                  <Thumb layout={l} width={width} height={height} />
                </div>
                <span className="truncate px-1 py-0.5 text-[11px] text-neutral-200">{t(`layouts.names.${l.id}`)}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
