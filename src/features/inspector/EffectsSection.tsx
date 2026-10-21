import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { defaultParams, EFFECT_DEFS, moveEffect, type ParamSpec } from '../../model/effects';
import type { Asset, Clip, Effect } from '../../model/types';
import { useSubtitlesUi } from '../subtitles/subtitlesUi';
import type { SetFn } from './ClipInspector';
import { ColorField, NumberField, Section, SelectField } from './controls';
import { FramePicker } from './FramePicker';

/** Effects whose colour is best picked from the clip's own (un-keyed) frame. */
const KEYING = new Set<Effect['kind']>(['keylight', 'linearColorKey', 'colorRange']);

/** The clip's effect stack, top = applied first: switch, reorder, reset, remove, and settings. */
export function EffectsSection({ clip, asset, set }: { clip: Clip; asset?: Asset; set: SetFn }) {
  const { t } = useTranslation();
  const effects = clip.effects ?? [];
  return (
    <Section title={t('effects.stack')}>
      {effects.length === 0 && (
        <p className="text-xs text-neutral-400">
          {t('effects.none')}{' '}
          <button className="text-accent underline" onClick={() => useSubtitlesUi.setState({ tab: 'effects' })}>
            {t('effects.open')}
          </button>
        </p>
      )}
      <div className="space-y-2" data-testid="effect-stack">
        {effects.map((e, i) => (
          <EffectCard key={e.id} effect={e} first={i === 0} last={i === effects.length - 1} set={set} clip={clip} asset={asset} />
        ))}
      </div>
    </Section>
  );
}

function EffectCard({ effect, first, last, set, clip, asset }: { effect: Effect; first: boolean; last: boolean; set: SetFn; clip: Clip; asset?: Asset }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(true);
  const def = EFFECT_DEFS[effect.kind];
  const name = effect.kind === 'look' ? `${t('filters.label')}: ${t(`filters.names.${effect.params.preset}`)}` : t(`effects.names.${effect.kind}`);
  const edit = (prop: string, fn: (e: Effect) => void) =>
    set(`fx.${effect.id}.${prop}`, (c) => {
      const e = c.effects?.find((x) => x.id === effect.id);
      if (e) fn(e);
    });
  const iconBtn = 'rounded px-1.5 text-neutral-300 hover:bg-surface-3 disabled:opacity-30';
  return (
    <div className={`rounded border border-line bg-surface-2 ${effect.enabled ? '' : 'opacity-60'}`} data-testid="effect-card" data-kind={effect.kind}>
      <div className="flex items-center gap-1 px-1.5 py-1 text-xs">
        <input
          type="checkbox"
          checked={effect.enabled}
          aria-label={t('effects.enabled')}
          title={t('effects.enabled')}
          onChange={(ev) => edit('enabled', (x) => void (x.enabled = ev.target.checked))}
        />
        <button className="min-w-0 flex-1 truncate text-start font-medium text-white" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          {open ? '▾' : '▸'} {name}
        </button>
        <button className={iconBtn} disabled={first} onClick={() => set('fx.order', (c) => moveEffect(c, effect.id, -1))} aria-label={t('effects.up')} title={t('effects.up')}>
          ↑
        </button>
        <button className={iconBtn} disabled={last} onClick={() => set('fx.order', (c) => moveEffect(c, effect.id, 1))} aria-label={t('effects.down')} title={t('effects.down')}>
          ↓
        </button>
        <button
          className={iconBtn}
          onClick={() => edit('reset', (x) => void (x.params = { ...defaultParams(x.kind), ...(x.kind === 'look' ? { preset: x.params.preset } : {}) }))}
          aria-label={t('effects.reset')}
          title={t('effects.reset')}
        >
          ↺
        </button>
        <button
          className={`${iconBtn} text-red-300`}
          onClick={() => set('fx.remove', (c) => void (c.effects = c.effects?.filter((x) => x.id !== effect.id)))}
          aria-label={t('effects.remove')}
          title={t('effects.remove')}
          data-testid="effect-remove"
        >
          ✕
        </button>
      </div>
      {open && def.params.length > 0 && (
        <div className="space-y-2 border-t border-line px-2 py-2">
          {def.params.map((p) => (
            <ParamField key={p.key} spec={p} effect={effect} edit={edit} picker={KEYING.has(effect.kind) && (asset?.kind === 'video' || asset?.kind === 'image') ? { clip, asset: asset! } : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

function ParamField({
  spec,
  effect,
  edit,
  picker,
}: {
  spec: ParamSpec;
  effect: Effect;
  edit: (prop: string, fn: (e: Effect) => void) => void;
  /** Colours can be picked from this clip's frame. */
  picker?: { clip: Clip; asset: Asset };
}) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const label = t(`effects.params.${spec.key}`, { defaultValue: spec.key });
  const value = (key: string, fallback: unknown) => effect.params[key] ?? fallback;
  const setParam = (key: string, v: number | string | boolean) => edit(key, (e) => void (e.params[key] = v));
  switch (spec.type) {
    case 'number':
      return (
        <NumberField label={label} value={Number(value(spec.key, spec.default))} min={spec.min} max={spec.max} step={spec.step ?? 0.01} unit={spec.unit} onChange={(v) => setParam(spec.key, v)} />
      );
    case 'color':
      return (
        <>
          <ColorField label={label} value={String(value(spec.key, spec.default))} onChange={(v) => setParam(spec.key, v ?? spec.default)} />
          {picker && (
            <button className={`rounded px-2 py-0.5 text-xs ${picking ? 'bg-accent text-white' : 'bg-surface-3 hover:bg-[#363c49]'}`} data-testid="pick-color" aria-pressed={picking} onClick={() => setPicking((p) => !p)}>
              ⌖ {t('effects.pickFromFrame')}
            </button>
          )}
          {picker && picking && (
            <FramePicker
              clip={picker.clip}
              asset={picker.asset}
              onPick={(hex) => {
                setParam(spec.key, hex);
                setPicking(false);
              }}
            />
          )}
        </>
      );
    case 'bool':
      return (
        <label className="flex items-center gap-2 text-xs text-neutral-300">
          <input type="checkbox" checked={Boolean(value(spec.key, spec.default))} onChange={(e) => setParam(spec.key, e.target.checked)} />
          {label}
        </label>
      );
    case 'select':
      return (
        <SelectField
          label={label}
          value={String(value(spec.key, spec.default))}
          options={spec.options.map((o) => ({ value: o, label: spec.key === 'preset' ? t(`filters.names.${o}`) : t(`effects.options.${o}`, { defaultValue: o }) }))}
          onChange={(v) => setParam(spec.key, v)}
        />
      );
    case 'point':
      return (
        <>
          <NumberField label={`${label} X`} value={Number(value(`${spec.key}X`, spec.default[0]))} min={-0.5} max={1.5} factor={100} unit="%" onChange={(v) => setParam(`${spec.key}X`, v)} />
          <NumberField label={`${label} Y`} value={Number(value(`${spec.key}Y`, spec.default[1]))} min={-0.5} max={1.5} factor={100} unit="%" onChange={(v) => setParam(`${spec.key}Y`, v)} />
        </>
      );
  }
}
