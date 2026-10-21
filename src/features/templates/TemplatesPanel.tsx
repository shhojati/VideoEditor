import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ensureFont } from '../../lib/fonts';
import { createProject } from '../../model/factories';
import { insertTemplate, TEMPLATE_CATEGORIES, templateName, type Template } from '../../model/templates';
import { renderFrame } from '../../engine/render/renderFrame';
import { useProject } from '../../store/projectStore';
import { addTemplate, allTemplates, loadServerTemplates, useTemplates } from './templateService';

const THUMB_W = 160;

/** A template drawn by the real compositor, a little past its middle (animations settled). */
async function thumbnail(tpl: Template, size: { width: number; height: number }, rtl: boolean): Promise<string> {
  const p = createProject('thumb');
  p.settings = { ...p.settings, ...size };
  p.tracks = [];
  insertTemplate(p, tpl, 0, rtl);
  const fonts = new Set(p.tracks.flatMap((t) => t.clips).flatMap((c) => (c.text ? [`${c.text.fontFamily}@${c.text.fontWeight}`] : [])));
  await Promise.all([...fonts].map((f) => ensureFont(f.split('@')[0], Number(f.split('@')[1])).catch(() => {})));
  const k = THUMB_W / size.width;
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_W;
  canvas.height = Math.round(size.height * k);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(k, 0, 0, k, 0, 0);
  renderFrame(p, tpl.duration * 0.6, ctx, () => undefined, { subtitles: false });
  return canvas.toDataURL('image/jpeg', 0.8);
}

/** Ready-made titles, intros, lower thirds and outros; click (or drag) to add at the playhead. */
export function TemplatesPanel() {
  const { t, i18n } = useTranslation();
  const project = useProject();
  const { server, invalid, loaded } = useTemplates();
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const size = project ? { width: project.settings.width, height: project.settings.height } : { width: 1920, height: 1080 };
  const rtl = i18n.language === 'fa';
  const templates = allTemplates(server);

  useEffect(() => {
    if (!loaded) void loadServerTemplates();
  }, [loaded]);
  useEffect(() => {
    let alive = true;
    void (async () => {
      const out: Record<string, string> = {};
      for (const tpl of templates) out[tpl.id] = await thumbnail(tpl, size, rtl);
      if (alive) setThumbs(out);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw when the list, aspect or language changes
  }, [server, size.width, size.height, rtl]);

  return (
    <div className="space-y-3 p-2 text-xs" data-testid="templates-panel">
      <p className="text-neutral-400">{t('templates.hint')}</p>
      {TEMPLATE_CATEGORIES.map((category) => {
        const list = templates.filter((x) => x.category === category);
        if (!list.length) return null;
        return (
          <section key={category}>
            <h3 className="mb-1.5 text-[11px] font-medium tracking-wide text-neutral-400 uppercase">{t(`templates.categories.${category}`)}</h3>
            <div className="grid grid-cols-2 gap-1.5">
              {list.map((tpl) => (
                <button
                  key={tpl.id}
                  data-testid="template-item"
                  data-template={tpl.id}
                  className="flex flex-col overflow-hidden rounded bg-surface-2 text-start hover:ring-1 hover:ring-accent"
                  title={t('templates.itemHint')}
                  onClick={() => addTemplate(tpl)}
                >
                  <div className="w-full bg-black" style={{ aspectRatio: `${size.width} / ${size.height}` }}>
                    {thumbs[tpl.id] && <img src={thumbs[tpl.id]} alt="" draggable={false} className="h-full w-full object-cover" />}
                  </div>
                  <span className="truncate px-1 py-0.5 text-[11px] text-neutral-200">{templateName(tpl, i18n.language)}</span>
                </button>
              ))}
            </div>
          </section>
        );
      })}
      {invalid.length > 0 && <p className="text-[11px] text-amber-300">{t('templates.invalid', { files: invalid.join(', ') })}</p>}
    </div>
  );
}
