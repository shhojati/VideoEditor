import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { applyEffects } from '../../engine/effects/applyEffects';
import { createEffect } from '../../model/effects';
import { LOOK_MENU, type LookId } from '../../model/looks';
import { BUILTIN_LUT_IDS, builtinLut, type BuiltinLutId } from '../../model/luts';
import { findClip } from '../../model/timeline';
import { useProject } from '../../store/projectStore';
import { useTimelineUi } from '../timeline/timelineUi';
import { applyFx, fxDrag } from './effectActions';

const THUMB_W = 96;
const THUMB_H = 64;

/** The current preview picture, or a sample scene when the preview is empty. */
function sampleImage(): OffscreenCanvas {
  const c = new OffscreenCanvas(THUMB_W, THUMB_H);
  const ctx = c.getContext('2d')!;
  const preview = document.querySelector<HTMLCanvasElement>('[data-testid=preview-canvas]');
  const frame = document.querySelector('[data-testid=preview-frame]')?.getBoundingClientRect();
  if (preview && frame && frame.width > 0) {
    const r = preview.getBoundingClientRect();
    const k = preview.width / Math.max(1, r.width);
    const sx = (frame.left - r.left) * k;
    const sy = (frame.top - r.top) * k;
    const sw = frame.width * k;
    const sh = frame.height * k;
    // Cover the thumbnail with the middle of the frame.
    const scale = Math.max(THUMB_W / sw, THUMB_H / sh);
    const w = THUMB_W / scale;
    const h = THUMB_H / scale;
    ctx.drawImage(preview, sx + (sw - w) / 2, sy + (sh - h) / 2, w, h, 0, 0, THUMB_W, THUMB_H);
    const d = ctx.getImageData(0, 0, THUMB_W, THUMB_H).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 16) sum += d[i] + d[i + 1] + d[i + 2];
    if (sum / (d.length / 16) > 30) return c;
  }
  // Sky, sun, hills and a face-coloured disc: enough to show what a look does to colour and tone.
  const sky = ctx.createLinearGradient(0, 0, 0, THUMB_H);
  sky.addColorStop(0, '#4f8fd8');
  sky.addColorStop(0.6, '#f2c48a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, THUMB_W, THUMB_H);
  ctx.fillStyle = '#fff3c4';
  ctx.beginPath();
  ctx.arc(72, 20, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3d7a3a';
  ctx.beginPath();
  ctx.ellipse(30, 70, 60, 26, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#d9a07a';
  ctx.beginPath();
  ctx.arc(30, 36, 12, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

/** One data URL per preset (looks, and built-in LUTs as `lut:<id>`), rendered with the real shaders. */
function renderThumbs(ids: readonly LookId[], lutIds: readonly BuiltinLutId[] = []): Record<string, string> {
  const base = sampleImage();
  const out: Record<string, string> = {};
  const work = new OffscreenCanvas(THUMB_W, THUMB_H);
  const plain = document.createElement('canvas');
  plain.width = THUMB_W;
  plain.height = THUMB_H;
  const items = [...ids.map((id) => ({ key: id, effect: createEffect('look', { preset: id }) })), ...lutIds.map((id) => ({ key: `lut:${id}`, effect: createEffect('lut3d', { lut: id }) }))];
  const luts = Object.fromEntries(lutIds.map((id) => [id, builtinLut(id)]));
  for (const { key, effect } of items) {
    const ctx = work.getContext('2d')!;
    ctx.globalCompositeOperation = 'copy';
    ctx.drawImage(base, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    const ok = applyEffects(work, [effect], {
      luts,
      key: `thumb:${key}`,
      time: 0.5,
      local: 0.5,
      duration: 1,
      scale: THUMB_H / 540,
      unit: THUMB_H / 1080,
      frame: { x: 0, y: 0, w: THUMB_W, h: THUMB_H },
    });
    if (!ok) break;
    const p = plain.getContext('2d')!;
    p.clearRect(0, 0, THUMB_W, THUMB_H);
    p.drawImage(work, 0, 0);
    out[key] = plain.toDataURL('image/jpeg', 0.8);
  }
  return out;
}

/** One-tap looks with an intensity (edited in the inspector). Click: selected clips or a new adjustment layer. */
export function FiltersPanel() {
  const { t } = useTranslation();
  const project = useProject();
  const selection = useTimelineUi((s) => s.selection);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [version, setVersion] = useState(0);

  const ids = useMemo(() => [...new Set(LOOK_MENU.flatMap((g) => g.ids))], []);
  useEffect(() => {
    // After paint, so the tab shows at once.
    const id = requestAnimationFrame(() => setThumbs(renderThumbs(ids, BUILTIN_LUT_IDS)));
    return () => cancelAnimationFrame(id);
  }, [ids, version]);

  // The preset on the (single) selected clip, highlighted in the grid.
  const current = useMemo(() => {
    if (!project || selection.length !== 1) return undefined;
    return findClip(project, selection[0])?.clip.effects?.find((e) => e.kind === 'look')?.params.preset as string | undefined;
  }, [project, selection]);

  return (
    <div className="flex h-full flex-col" data-testid="filters-panel">
      <div className="flex items-center gap-1 border-b border-line p-2 text-xs text-neutral-400">
        <span className="flex-1">{t('filters.hint')}</span>
        <button className="rounded px-2 text-sm text-neutral-300 hover:bg-surface-3" onClick={() => setVersion((v) => v + 1)} title={t('filters.refresh')} aria-label={t('filters.refresh')}>
          ⟳
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        {LOOK_MENU.map((g) => (
          <section key={g.category} className="mb-3">
            <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-neutral-400 uppercase">{t(`filters.categories.${g.category}`)}</h3>
            <div className="grid grid-cols-3 gap-1.5">
              {g.ids.map((id) => (
                <button
                  key={id}
                  draggable
                  data-testid="filter-item"
                  data-preset={id}
                  aria-pressed={current === id}
                  className={`flex flex-col overflow-hidden rounded bg-surface-2 text-start hover:ring-1 hover:ring-accent ${current === id ? 'ring-2 ring-accent' : ''}`}
                  title={t('effects.itemHint')}
                  onClick={() => applyFx({ type: 'filter', preset: id })}
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = 'copy';
                    e.dataTransfer.setData('text/plain', id);
                    fxDrag.item = { type: 'filter', preset: id };
                  }}
                  onDragEnd={() => (fxDrag.item = null)}
                >
                  <div className="aspect-[3/2] w-full bg-surface-3">{thumbs[id] && <img src={thumbs[id]} alt="" draggable={false} className="h-full w-full object-cover" />}</div>
                  <span className="truncate px-1 py-0.5 text-[10px] text-neutral-300">{t(`filters.names.${id}`)}</span>
                </button>
              ))}
            </div>
          </section>
        ))}
        <section className="mb-3" data-testid="lut-pack">
          <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-neutral-400 uppercase">{t('luts.title')}</h3>
          <div className="grid grid-cols-3 gap-1.5">
            {BUILTIN_LUT_IDS.map((id) => (
              <button
                key={id}
                draggable
                data-testid="lut-item"
                data-lut={id}
                className="flex flex-col overflow-hidden rounded bg-surface-2 text-start hover:ring-1 hover:ring-accent"
                title={t('effects.itemHint')}
                onClick={() => applyFx({ type: 'lut', id })}
                onDragStart={(e) => {
                  e.dataTransfer.effectAllowed = 'copy';
                  e.dataTransfer.setData('text/plain', id);
                  fxDrag.item = { type: 'lut', id };
                }}
                onDragEnd={() => (fxDrag.item = null)}
              >
                <div className="aspect-[3/2] w-full bg-surface-3">{thumbs[`lut:${id}`] && <img src={thumbs[`lut:${id}`]} alt="" draggable={false} className="h-full w-full object-cover" />}</div>
                <span className="truncate px-1 py-0.5 text-[10px] text-neutral-300">{t(`luts.names.${id}`)}</span>
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-neutral-400">{t('luts.hint')}</p>
        </section>
      </div>
    </div>
  );
}
