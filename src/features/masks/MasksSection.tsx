import { useTranslation } from 'react-i18next';
import { maskShapeAt } from '../../engine/render/masks';
import { keyIndexAt, keyTolerance, type MaskPreset } from '../../model/masks';
import type { Animated, Clip, MaskMode, Project, RotoMask } from '../../model/types';
import { useTransport } from '../../store/transport';
import { NumberField, Section, SelectField } from '../inspector/controls';
import { cancelTracking, useTracking } from '../tracking/trackingService';
import {
  addPresetMask,
  cancelPen,
  deleteMask,
  finishPen,
  jumpToMaskKey,
  maskTrackers,
  moveMask,
  setActiveMask,
  setMaskAnimated,
  setMaskProps,
  setMaskTracker,
  setMaskTrackParts,
  setMaskValue,
  startPen,
  toggleMaskKey,
  trackMask,
  useMasks,
  type MaskAnimKey,
} from './maskService';

const btn = 'rounded bg-surface-3 px-2 py-1 text-xs hover:bg-[#363c49] disabled:opacity-40';
const iconBtn = 'rounded px-1.5 text-neutral-300 hover:bg-surface-3 disabled:opacity-30';
const MODES: MaskMode[] = ['add', 'subtract', 'intersect', 'difference'];
const PRESETS: { kind: MaskPreset; icon: string }[] = [
  { kind: 'rectangle', icon: '▭' },
  { kind: 'ellipse', icon: '◯' },
  { kind: 'polygon', icon: '⬠' },
];

/** A clip's roto masks: draw or add them, pick one to edit on the canvas, animate and track it. */
export function MasksSection({ project, clip }: { project: Project; clip: Clip }) {
  const { t } = useTranslation();
  const pen = useMasks((s) => s.pen);
  const active = useMasks((s) => s.active);
  const masks = clip.masks ?? [];
  const current = active?.clipId === clip.id ? masks.find((m) => m.id === active.maskId) : undefined;
  const nextName = () => t('masks.nameN', { n: masks.length + 1 });
  const drawing = pen?.clipId === clip.id;

  return (
    <Section title={t('masks.title')}>
      <div data-testid="masks-section" className="space-y-2">
        {drawing ? (
          <div className="space-y-1.5 rounded border border-yellow-400/50 p-2" data-testid="mask-pen-hint">
            <p className="text-[11px] text-neutral-300">{t('masks.penHint')}</p>
            <div className="flex gap-1">
              <button className={btn} disabled={pen.points.length < 3} onClick={() => finishPen(nextName())}>
                {t('masks.close')}
              </button>
              <button className={btn} onClick={cancelPen}>
                {t('masks.cancel')}
              </button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap gap-1">
            <button className={btn} data-testid="mask-pen-start" title={t('masks.penTitle')} onClick={() => startPen(clip.id)}>
              ✎ {t('masks.pen')}
            </button>
            {PRESETS.map((p) => (
              <button
                key={p.kind}
                className={btn}
                data-testid={`mask-add-${p.kind}`}
                title={t(`masks.presets.${p.kind}`)}
                aria-label={t(`masks.presets.${p.kind}`)}
                onClick={() => addPresetMask(clip.id, p.kind, nextName())}
              >
                {p.icon}
              </button>
            ))}
          </div>
        )}
        {!masks.length && !drawing && <p className="text-xs text-neutral-400">{clip.adjustment ? t('masks.introAdjustment') : t('masks.intro')}</p>}
        {masks.map((m, i) => (
          <MaskRow key={m.id} clip={clip} mask={m} index={i} count={masks.length} selected={m.id === current?.id} />
        ))}
        {current && <MaskDetails project={project} clip={clip} mask={current} />}
      </div>
    </Section>
  );
}

function MaskRow({ clip, mask, index, count, selected }: { clip: Clip; mask: RotoMask; index: number; count: number; selected: boolean }) {
  const { t } = useTranslation();
  return (
    <div className={`flex items-center gap-1 rounded px-1.5 py-1 ${selected ? 'bg-yellow-500/10' : ''}`} data-testid="mask-row">
      <input type="radio" checked={selected} aria-label={t('masks.select')} title={t('masks.select')} onChange={() => setActiveMask(clip.id, mask.id)} />
      <input
        type="checkbox"
        checked={!mask.off}
        aria-label={t('masks.on')}
        title={t('masks.on')}
        onChange={(e) => setMaskProps(clip.id, mask.id, { off: !e.target.checked })}
      />
      <input
        className="min-w-0 flex-1 rounded bg-surface-3 px-1.5 py-0.5 text-xs"
        dir="auto"
        aria-label={t('masks.name')}
        value={mask.name}
        onFocus={() => setActiveMask(clip.id, mask.id)}
        onChange={(e) => setMaskProps(clip.id, mask.id, { name: e.target.value })}
      />
      <button className={iconBtn} disabled={index === 0} aria-label={t('masks.up')} title={t('masks.up')} onClick={() => moveMask(clip.id, mask.id, -1)}>
        ↑
      </button>
      <button className={iconBtn} disabled={index === count - 1} aria-label={t('masks.down')} title={t('masks.down')} onClick={() => moveMask(clip.id, mask.id, 1)}>
        ↓
      </button>
      <button className={iconBtn} aria-label={t('masks.delete')} title={t('masks.delete')} onClick={() => deleteMask(clip.id, mask.id)}>
        ✕
      </button>
    </div>
  );
}

/** Stopwatch (animate), previous / add-remove / next keyframe for one property, at the playhead. */
function KeyControls({ clip, mask, anim, s, tol }: { clip: Clip; mask: RotoMask; anim: MaskAnimKey; s: number; tol: number }) {
  const { t } = useTranslation();
  const a = mask[anim] as Animated<unknown>;
  const animated = !!a.keys;
  const here = keyIndexAt(a, s, tol) >= 0;
  const key = { maskId: mask.id, anim };
  return (
    <div className="flex shrink-0 items-center" dir="ltr">
      <button
        className={`${iconBtn} ${animated ? 'text-yellow-300' : ''}`}
        aria-pressed={animated}
        data-testid={`mask-animate-${anim}`}
        title={t(animated ? 'masks.stopAnimating' : 'masks.animate')}
        aria-label={t(animated ? 'masks.stopAnimating' : 'masks.animate')}
        onClick={() => setMaskAnimated(clip.id, mask.id, anim, !animated)}
      >
        ◷
      </button>
      {animated && (
        <>
          <button className={iconBtn} title={t('masks.prevKey')} aria-label={t('masks.prevKey')} onClick={() => jumpToMaskKey(clip.id, -1, key)}>
            ◀
          </button>
          <button
            className={`${iconBtn} text-yellow-300`}
            data-testid={`mask-key-${anim}`}
            title={t(here ? 'masks.removeKey' : 'masks.addKey')}
            aria-label={t(here ? 'masks.removeKey' : 'masks.addKey')}
            onClick={() => toggleMaskKey(clip.id, mask.id, anim)}
          >
            {here ? '◆' : '◇'}
          </button>
          <button className={iconBtn} title={t('masks.nextKey')} aria-label={t('masks.nextKey')} onClick={() => jumpToMaskKey(clip.id, 1, key)}>
            ▶
          </button>
        </>
      )}
    </div>
  );
}

function MaskDetails({ project, clip, mask }: { project: Project; clip: Clip; mask: RotoMask }) {
  const { t } = useTranslation();
  // While playing the values stay put instead of re-rendering on every clock tick.
  const time = useTransport((s) => (s.playing ? -1 : s.time));
  const at = time < 0 || time < clip.start || time >= clip.start + clip.duration ? clip.start : time;
  const s = clip.inPoint + (at - clip.start) * clip.speed;
  const tol = keyTolerance(project.settings.fps, clip.speed);
  const shape = maskShapeAt(project, clip, mask, s);
  const keys = { clip, mask, s, tol };
  const max = 2 * Math.max(project.settings.width, project.settings.height);

  return (
    <div className="space-y-2 rounded border border-yellow-400/40 p-2" data-testid="mask-details">
      <p className="text-[11px] text-neutral-400">{t('masks.editHint')}</p>
      <SelectField
        label={t('masks.mode')}
        value={mask.mode}
        options={MODES.map((m) => ({ value: m, label: t(`masks.modes.${m}`) }))}
        onChange={(v) => setMaskProps(clip.id, mask.id, { mode: v })}
      />
      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" data-testid="mask-invert" checked={!!mask.inverted} onChange={(e) => setMaskProps(clip.id, mask.id, { inverted: e.target.checked })} />
        {t('masks.invert')}
      </label>
      <div className="flex items-center justify-between gap-1 text-xs">
        <span className="text-neutral-400">{t('masks.path')}</span>
        <KeyControls anim="path" {...keys} />
      </div>
      <div className="flex items-end gap-1">
        <div className="min-w-0 flex-1">
          <NumberField label={t('masks.feather')} value={shape.feather} min={0} max={500} step={1} unit="px" onChange={(v) => setMaskValue(clip.id, mask.id, 'feather', v)} />
        </div>
        <KeyControls anim="feather" {...keys} />
      </div>
      <div className="flex items-end gap-1">
        <div className="min-w-0 flex-1">
          <NumberField label={t('masks.expansion')} value={shape.expansion} min={-max / 4} max={max / 4} step={1} unit="px" onChange={(v) => setMaskValue(clip.id, mask.id, 'expansion', v)} />
        </div>
        <KeyControls anim="expansion" {...keys} />
      </div>
      <div className="flex items-end gap-1">
        <div className="min-w-0 flex-1">
          <NumberField label={t('masks.opacity')} value={shape.opacity} min={0} max={1} factor={100} unit="%" onChange={(v) => setMaskValue(clip.id, mask.id, 'opacity', v)} />
        </div>
        <KeyControls anim="opacity" {...keys} />
      </div>
      {project.assets[clip.assetId ?? '']?.kind === 'video' && <MaskTracking project={project} clip={clip} mask={mask} />}
    </div>
  );
}

function MaskTracking({ project, clip, mask }: { project: Project; clip: Clip; mask: RotoMask }) {
  const { t } = useTranslation();
  const job = useTracking((s) => s.job);
  const error = useTracking((s) => s.error);
  const trackers = maskTrackers(project, clip);
  const link = mask.track;
  const running = !!job && job.trackerId === link?.trackerId;
  const own = !link || !!clip.trackers?.some((x) => x.id === link.trackerId);
  const name = t('masks.trackerName', { name: mask.name });
  return (
    <div className="space-y-1.5 border-t border-line pt-2" data-testid="mask-tracking">
      <SelectField
        label={t('masks.follow')}
        value={link?.trackerId ?? ''}
        options={[{ value: '', label: t('masks.followNone') }, ...trackers.map((x) => ({ value: x.id, label: x.name }))]}
        onChange={(v) => setMaskTracker(clip.id, mask.id, v || null)}
      />
      {link && (
        <div className="flex gap-3 text-xs">
          {(['position', 'rotation', 'scale'] as const).map((k) => (
            <label key={k} className="flex items-center gap-1">
              <input type="checkbox" checked={link[k]} onChange={(e) => setMaskTrackParts(clip.id, mask.id, { [k]: e.target.checked })} />
              {t(`tracking.${k}`)}
            </label>
          ))}
        </div>
      )}
      {running ? (
        <div className="flex items-center gap-2" data-testid="mask-tracking-progress">
          <div className="h-1.5 flex-1 rounded bg-surface-3">
            <div className="h-1.5 rounded bg-amber-400" style={{ width: `${Math.round(job.progress * 100)}%` }} />
          </div>
          <span className="text-[11px] text-neutral-300">{t('tracking.running', { pct: Math.round(job.progress * 100) })}</span>
          <button className={btn} onClick={cancelTracking}>
            {t('tracking.cancel')}
          </button>
        </div>
      ) : (
        own && (
          <div className="flex gap-1" dir="ltr">
            <button className={`${btn} flex-1`} data-testid="mask-track-backward" disabled={!!job} onClick={() => trackMask(clip.id, mask.id, -1, name)}>
              {t('masks.trackBack')}
            </button>
            <button className={`${btn} flex-1`} data-testid="mask-track-forward" disabled={!!job} onClick={() => trackMask(clip.id, mask.id, 1, name)}>
              {t('masks.trackForward')}
            </button>
          </div>
        )
      )}
      {error && !job && link && <p className="text-[11px] text-red-300">{t(`tracking.errors.${error}`)}</p>}
      <p className="text-[11px] text-neutral-400">{t('masks.trackHint')}</p>
    </div>
  );
}
