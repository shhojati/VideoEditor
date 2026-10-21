import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { EFFECT_DEFS, EFFECT_MENU } from '../../model/effects';
import type { EffectKind } from '../../model/types';
import { addAdjustmentLayer, applyFx, fxDrag } from './effectActions';

/** After Effects' effect menu: click applies to the selection (or a new adjustment layer); drag onto a clip. */
export function EffectsPanel() {
  const { t } = useTranslation();
  const [query, setQuery] = useState('');
  const [closed, setClosed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return EFFECT_MENU.map((g) => ({
      ...g,
      kinds: g.kinds.filter((k) => !q || EFFECT_DEFS[k].name.toLowerCase().includes(q) || t(`effects.names.${k}`).toLowerCase().includes(q)),
    })).filter((g) => g.kinds.length);
  }, [query, t]);

  return (
    <div className="flex h-full flex-col" data-testid="effects-panel">
      <div className="flex gap-1 border-b border-line p-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('library.search')}
          aria-label={t('library.search')}
          className="min-w-0 flex-1 rounded bg-surface-3 px-2 py-1 text-xs"
        />
        <button className="rounded bg-surface-3 px-2 text-xs hover:bg-accent" onClick={addAdjustmentLayer} title={t('effects.adjustmentHint')} data-testid="add-adjustment">
          ◫ {t('effects.adjustment')}
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-1">
        {groups.map((g) => {
          const isClosed = closed[g.category] && !query;
          return (
            <section key={g.category} className="mb-1">
              <button
                className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-start text-[11px] font-semibold tracking-wide text-neutral-300 uppercase hover:bg-surface-2"
                onClick={() => setClosed((c) => ({ ...c, [g.category]: !c[g.category] }))}
                aria-expanded={!isClosed}
              >
                {isClosed ? '▸' : '▾'} {t(`effects.categories.${g.category}`)}
              </button>
              {!isClosed && (
                <ul>
                  {g.kinds.map((k, i) => (
                    <EffectItem key={`${k}${i}`} kind={k} />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      <p className="border-t border-line px-2 py-1.5 text-[11px] text-neutral-500">{t('effects.hint')}</p>
    </div>
  );
}

function EffectItem({ kind }: { kind: EffectKind }) {
  const { t } = useTranslation();
  const later = !!EFFECT_DEFS[kind].later;
  const name = t(`effects.names.${kind}`);
  return (
    <li>
      <button
        draggable={!later}
        disabled={later}
        data-testid="effect-item"
        data-kind={kind}
        className="flex w-full items-center gap-2 rounded px-3 py-1 text-start text-xs text-neutral-200 hover:bg-surface-3 disabled:cursor-not-allowed disabled:text-neutral-500 disabled:hover:bg-transparent"
        title={later ? t('effects.laterHint') : t('effects.itemHint')}
        onClick={() => applyFx({ type: 'effect', kind })}
        onDragStart={(e) => {
          e.dataTransfer.effectAllowed = 'copy';
          e.dataTransfer.setData('text/plain', name);
          fxDrag.item = { type: 'effect', kind };
        }}
        onDragEnd={() => (fxDrag.item = null)}
      >
        <span className="min-w-0 flex-1 truncate" dir="auto">
          {name}
        </span>
        {later && <span className="rounded bg-surface-3 px-1 text-[10px] text-neutral-400">{t('effects.later')}</span>}
      </button>
    </li>
  );
}
