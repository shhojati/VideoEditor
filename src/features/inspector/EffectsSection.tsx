import { ChevronDown, ChevronRight, ChevronUp, Pipette, RotateCcw, X } from 'lucide-react';
import { Icon } from '../../app/icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { defaultParams, EFFECT_DEFS, moveEffect, type ParamSpec } from '../../model/effects';
import type { Asset, Clip, Effect, Project } from '../../model/types';
import { useProject } from '../../store/projectStore';
import { LutField, WheelField } from './ColorControls';
import { openPane } from '../subtitles/subtitlesUi';
import type { SetFn } from './ClipInspector';
import { ColorField, NumberField, Section, SelectField } from './controls';
import { FramePicker } from './FramePicker';
import { resetClipSection } from './resetActions';

/** Effects whose colour is best picked from the clip's own (un-keyed) frame. */
const KEYING = new Set<Effect['kind']>(['keylight', 'linearColorKey', 'colorRange']);

/** The clip's effect stack, top = applied first: switch, reorder, reset, remove, and settings. */
export function EffectsSection({ clip, asset, set }: { clip: Clip; asset?: Asset; set: SetFn }) {
  const { t } = useTranslation();
  const effects = clip.effects ?? [];
  return (
    <Section id="effects" title={t('effects.stack')} onReset={effects.length ? () => resetClipSection(clip.id, 'effects') : undefined}>
      {effects.length === 0 && (
        <p className="text-xs text-neutral-400">
          {t('effects.none')}{' '}
          <button className="text-accent underline" onClick={() => openPane('effects')}>
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
  const edit = (prop: string, fn: (e: Effect, p: Project) => void) =>
    set(`fx.${effect.id}.${prop}`, (c, p) => {
      const e = c.effects?.find((x) => x.id === effect.id);
      if (e) fn(e, p);
    });
  const iconBtn = 'inline-flex items-center rounded-md px-1 py-0.5 text-neutral-300 hover:bg-surface-3 disabled:opacity-30';
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
        <button className="flex min-w-0 flex-1 items-center gap-1 text-start font-medium text-white" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
          <Icon icon={open ? ChevronDown : ChevronRight} size={14} className={`shrink-0 ${open ? '' : 'rtl:-scale-x-100'}`} />
          <span className="truncate">{name}</span>
        </button>
        <button className={iconBtn} disabled={first} onClick={() => set('fx.order', (c) => moveEffect(c, effect.id, -1))} aria-label={t('effects.up')} title={t('effects.up')}>
          <Icon icon={ChevronUp} size={14} />
        </button>
        <button className={iconBtn} disabled={last} onClick={() => set('fx.order', (c) => moveEffect(c, effect.id, 1))} aria-label={t('effects.down')} title={t('effects.down')}>
          <Icon icon={ChevronDown} size={14} />
        </button>
        <button
          className={iconBtn}
          onClick={() => edit('reset', (x) => void (x.params = { ...defaultParams(x.kind), ...(x.kind === 'look' ? { preset: x.params.preset } : {}) }))}
          aria-label={t('effects.reset')}
          title={t('effects.reset')}
        >
          <Icon icon={RotateCcw} size={14} />
        </button>
        <button
          className={`${iconBtn} text-red-300`}
          onClick={() => set('fx.remove', (c) => void (c.effects = c.effects?.filter((x) => x.id !== effect.id)))}
          aria-label={t('effects.remove')}
          title={t('effects.remove')}
          data-testid="effect-remove"
        >
          <Icon icon={X} size={14} />
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
  edit: (prop: string, fn: (e: Effect, p: Project) => void) => void;
  /** Colours can be picked from this clip's frame. */
  picker?: { clip: Clip; asset: Asset };
}) {
  const { t } = useTranslation();
  const [picking, setPicking] = useState(false);
  const luts = useProject()?.luts;
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
            <button className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs ${picking ? 'bg-accent text-on-accent' : 'bg-surface-3 hover:bg-surface-4'}`} data-testid="pick-color" aria-pressed={picking} onClick={() => setPicking((p) => !p)}>
              <Icon icon={Pipette} size={14} />
              {t('effects.pickFromFrame')}
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
    case 'wheel':
      return (
        <WheelField
          label={label}
          x={Number(value(`${spec.key}X`, 0))}
          y={Number(value(`${spec.key}Y`, 0))}
          onChange={(x, y) =>
            edit(spec.key, (e) => {
              e.params[`${spec.key}X`] = x;
              e.params[`${spec.key}Y`] = y;
            })
          }
        />
      );
    case 'lut':
      return (
        <LutField
          label={label}
          value={String(value(spec.key, ''))}
          luts={luts}
          onChange={(id, add) =>
            edit(spec.key, (e, p) => {
              if (add) (p.luts ??= {})[add.id] = add.lut;
              e.params[spec.key] = id;
            })
          }
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
