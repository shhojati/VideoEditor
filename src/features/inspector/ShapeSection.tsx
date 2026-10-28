import { ClipboardCopy, ClipboardPaste, Diamond, Timer } from 'lucide-react';
import { Icon } from '../../app/icons';
import { useTranslation } from 'react-i18next';
import { keepsAspect, setShapeKind, shadowOffset, SHAPE_KINDS } from '../../model/overlays';
import type { ID, ShapeProps } from '../../model/types';
import { SHAPE_ICONS } from '../shapes/shapesUi';
import type { SetFn } from './ClipInspector';
import { ColorField, FADE_PRESETS, NumberField, Section, Segmented, SelectField } from './controls';
import { resetClipSection } from './resetActions';
import { setShapePathAnimated, toggleShapePathKey } from '../masks/maskService';
import { keyIndexAt, keyTolerance } from '../../model/masks';
import i18n from '../../i18n';
import { showToast } from '../../app/toasts';
import { toPathData } from '../../lib/svgPath';
import { setShapePathData } from '../timeline/actions';

/**
 * Shape type, size, fill, stroke (colour, width, opacity, dashes), corners, star, arrows, shadow,
 * fades. A pen-drawn shape instead has open/closed and keyframes for its path (`keyAt`: the source
 * time at the playhead).
 */
export function ShapeSection({ clipId, shape, set, maxSize, keyAt, fps }: { clipId: ID; shape: ShapeProps; set: SetFn; maxSize: number; keyAt: number; fps: number }) {
  const { t } = useTranslation();
  const isPath = shape.kind === 'path';
  const setShape = <K extends keyof ShapeProps>(key: K, v: ShapeProps[K]) => set(`shape.${key}`, (c) => void (c.shape![key] = v));
  const isLine = shape.kind === 'line' || (isPath && !shape.closed);
  const square = keepsAspect(shape.kind);
  const hasStroke = isLine || !!shape.stroke;
  const preset = FADE_PRESETS.find((p) => p.value === shape.fadeIn && p.value === shape.fadeOut)?.key ?? 'custom';

  return (
    <Section id="shape" title={t('inspector.shape')} onReset={() => resetClipSection(clipId, 'shape')}>
      {isPath ? (
        <PathControls clipId={clipId} shape={shape} set={set} keyAt={keyAt} fps={fps} />
      ) : (
        <SelectField
          label={t('inspector.kind')}
          value={shape.kind}
          options={SHAPE_KINDS.map((k) => ({ value: k, label: `${SHAPE_ICONS[k]} ${t(`shapes.${k}`)}` }))}
          onChange={(v) => set('shape.kind', (c) => setShapeKind(c.shape!, v))}
        />
      )}
      {!isPath && <NumberField
        label={isLine ? t('inspector.length') : t('inspector.width')}
        value={shape.width}
        min={4}
        max={maxSize}
        step={1}
        unit="px"
        onChange={(v) =>
          set('shape.width', (c) => {
            c.shape!.width = v;
            if (square) c.shape!.height = v;
          })
        }
      />}
      {!isLine && !square && !isPath && (
        <NumberField label={t('inspector.height')} value={shape.height} min={4} max={maxSize} step={1} unit="px" onChange={(v) => setShape('height', v)} />
      )}

      {!isLine && (
        <>
          <ColorField label={t('inspector.fill')} optional fallback="#2563eb" value={shape.fill} onChange={(v) => setShape('fill', v)} />
          {shape.fill && (
            <>
              <NumberField label={t('inspector.fillOpacity')} value={shape.fillOpacity ?? 1} min={0} max={1} factor={100} unit="%" onChange={(v) => setShape('fillOpacity', v)} />
              <Segmented
                label={t('shapes.fillKind')}
                value={shape.gradient?.kind ?? 'solid'}
                options={(['solid', 'linear', 'radial'] as const).map((k) => ({ value: k, label: t(`shapes.fillKinds.${k}`) }))}
                onChange={(k) =>
                  set('shape.gradient', (c) => {
                    if (k === 'solid') delete c.shape!.gradient;
                    else c.shape!.gradient = { kind: k, to: c.shape!.gradient?.to ?? '#ffffff', angle: c.shape!.gradient?.angle ?? 90 };
                  })
                }
              />
              {shape.gradient && (
                <>
                  <ColorField alpha label={t('shapes.gradientTo')} value={shape.gradient.to} onChange={(v) => v && set('shape.gradient.to', (c) => void (c.shape!.gradient!.to = v))} />
                  {shape.gradient.kind === 'linear' && (
                    <NumberField label={t('shapes.gradientAngle')} value={shape.gradient.angle} min={0} max={360} step={1} unit="°" onChange={(v) => set('shape.gradient.angle', (c) => void (c.shape!.gradient!.angle = v))} />
                  )}
                </>
              )}
              <NumberField label={t('shapes.feather')} value={shape.feather ?? 0} min={0} max={200} step={1} unit="px" onChange={(v) => setShape('feather', v || undefined)} />
            </>
          )}
        </>
      )}

      <ColorField
        label={t('inspector.shapeStroke')}
        optional={!isLine}
        fallback="#ffffff"
        value={isLine ? (shape.stroke ?? '#ffffff') : shape.stroke}
        onChange={(v) =>
          set('shape.stroke', (c) => {
            c.shape!.stroke = v;
            if (v && !c.shape!.strokeWidth) c.shape!.strokeWidth = 6;
          })
        }
      />
      {hasStroke && (
        <>
          <NumberField label={t('inspector.strokeWidth')} value={shape.strokeWidth} min={0} max={80} step={0.5} unit="px" onChange={(v) => setShape('strokeWidth', v)} />
          <NumberField label={t('inspector.strokeOpacity')} value={shape.strokeOpacity ?? 1} min={0} max={1} factor={100} unit="%" onChange={(v) => setShape('strokeOpacity', v)} />
          <Segmented
            label={t('inspector.dash')}
            value={shape.dash ?? 'solid'}
            options={(['solid', 'dash', 'dot'] as const).map((d) => ({ value: d, label: t(`inspector.dashes.${d}`) }))}
            onChange={(v) => setShape('dash', v === 'solid' ? undefined : v)}
          />
          {isLine && (
            <Segmented
              label={t('shapes.cap')}
              value={shape.cap ?? 'round'}
              options={(['butt', 'round', 'square'] as const).map((c) => ({ value: c, label: t(`shapes.caps.${c}`) }))}
              onChange={(v) => setShape('cap', v === 'round' ? undefined : v)}
            />
          )}
          {shape.kind !== 'line' && (
            <Segmented
              label={t('shapes.join')}
              value={shape.join ?? 'round'}
              options={(['miter', 'round', 'bevel'] as const).map((j) => ({ value: j, label: t(`shapes.joins.${j}`) }))}
              onChange={(v) => setShape('join', v === 'round' ? undefined : v)}
            />
          )}
        </>
      )}

      {shape.kind === 'polygon' && (
        <NumberField label={t('shapes.sides')} value={shape.sides ?? 6} min={3} max={12} step={1} onChange={(v) => setShape('sides', Math.round(v))} />
      )}
      {(shape.kind === 'rectangle' || shape.kind === 'square' || shape.kind === 'triangle' || shape.kind === 'polygon') && (
        <NumberField
          label={t('inspector.corners')}
          value={shape.cornerRadius ?? 0}
          min={0}
          max={Math.round(Math.min(shape.width, shape.height) / 2)}
          step={1}
          unit="px"
          onChange={(v) => setShape('cornerRadius', v || undefined)}
        />
      )}
      {shape.kind === 'star' && (
        <>
          <NumberField label={t('inspector.points')} value={shape.points ?? 5} min={3} max={20} step={1} onChange={(v) => setShape('points', Math.round(v))} />
          <NumberField label={t('inspector.innerRadius')} value={shape.innerRadius ?? 0.5} min={0.1} max={0.95} factor={100} unit="%" onChange={(v) => setShape('innerRadius', v)} />
        </>
      )}
      {shape.kind === 'line' && (
        <Segmented
          label={t('inspector.arrows')}
          value={shape.arrowStart && shape.arrowEnd ? 'both' : shape.arrowStart ? 'start' : shape.arrowEnd ? 'end' : 'none'}
          options={[
            { value: 'none', label: t('inspector.none') },
            { value: 'start', label: '←', title: t('inspector.arrowStart') },
            { value: 'end', label: '→', title: t('inspector.arrowEnd') },
            { value: 'both', label: '↔' },
          ]}
          onChange={(v) =>
            set('shape.arrows', (c) => {
              c.shape!.arrowStart = v === 'start' || v === 'both' || undefined;
              c.shape!.arrowEnd = v === 'end' || v === 'both' || undefined;
            })
          }
        />
      )}

      <ColorField
        alpha
        label={t('inspector.shadow')}
        optional
        fallback="#000000"
        value={shape.shadowColor}
        onChange={(v) =>
          set('shape.shadowColor', (c) => {
            c.shape!.shadowColor = v;
            if (v && c.shape!.shadowBlur === undefined) c.shape!.shadowBlur = 16;
          })
        }
      />
      {shape.shadowColor && (
        <>
          <NumberField label={t('inspector.shadowBlur')} value={shape.shadowBlur ?? 0} min={0} max={80} step={1} unit="px" onChange={(v) => setShape('shadowBlur', v)} />
          {(['shadowX', 'shadowY'] as const).map((key) => (
            <NumberField
              key={key}
              label={t(`shapes.${key}`)}
              value={shadowOffset(shape)[key]}
              min={-500}
              max={500}
              step={1}
              unit="px"
              onChange={(v) =>
                set(`shape.${key}`, (c) => {
                  // The first change pins both, so the other one keeps what it showed.
                  Object.assign(c.shape!, shadowOffset(c.shape!), { [key]: v });
                })
              }
            />
          ))}
        </>
      )}

      <Segmented
        label={t('inspector.fade')}
        value={preset}
        options={[
          ...FADE_PRESETS.map((p) => ({ value: p.key as string, label: t(`inspector.fades.${p.key}`) })),
          ...(preset === 'custom' ? [{ value: 'custom', label: t('inspector.fades.custom') }] : []),
        ]}
        onChange={(key) => {
          const p = FADE_PRESETS.find((x) => x.key === key);
          if (p)
            set('shape.fadePreset', (c) => {
              c.shape!.fadeIn = p.value;
              c.shape!.fadeOut = p.value;
            });
        }}
      />
      <NumberField label={t('inspector.fadeIn')} value={shape.fadeIn} min={0} max={3} step={0.1} unit="s" onChange={(v) => setShape('fadeIn', v)} />
      <NumberField label={t('inspector.fadeOut')} value={shape.fadeOut} min={0} max={3} step={0.1} unit="s" onChange={(v) => setShape('fadeOut', v)} />
    </Section>
  );
}

/** A pen-drawn shape: closed or open, and its path's stopwatch and keyframe at the playhead. */
function PathControls({ clipId, shape, set, keyAt, fps }: { clipId: ID; shape: ShapeProps; set: SetFn; keyAt: number; fps: number }) {
  const { t } = useTranslation();
  const animated = !!shape.path?.keys;
  const here = animated && keyIndexAt(shape.path!, keyAt, keyTolerance(fps)) >= 0;
  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2 text-xs text-neutral-300">
        <input
          type="checkbox"
          checked={!!shape.closed}
          onChange={(e) =>
            set('shape.closed', (c) => {
              c.shape!.closed = e.target.checked;
              if (e.target.checked) c.shape!.fill ??= '#2563eb';
              else if (!c.shape!.stroke || !c.shape!.strokeWidth) {
                c.shape!.stroke ??= '#ffffff';
                c.shape!.strokeWidth = c.shape!.strokeWidth || 8;
              }
            })
          }
        />
        {t('shapes.closed')}
      </label>
      <div className="flex items-center gap-2 text-xs text-neutral-300">
        <label className="flex items-center gap-2" title={t('shapes.animatePathHint')}>
          <input type="checkbox" checked={animated} onChange={(e) => setShapePathAnimated(clipId, e.target.checked)} />
          <Icon icon={Timer} size={14} />
          {t('shapes.animatePath')}
        </label>
        {animated && (
          <button
            className={`inline-flex items-center rounded-md px-1.5 py-0.5 ${here ? 'bg-amber-500 text-black' : 'bg-surface-3 hover:bg-surface-4'}`}
            title={t(here ? 'shapes.removePathKey' : 'shapes.addPathKey')}
            aria-label={t(here ? 'shapes.removePathKey' : 'shapes.addPathKey')}
            aria-pressed={here}
            onClick={() => toggleShapePathKey(clipId)}
          >
            <Icon icon={Diamond} size={14} className={here ? 'fill-current' : ''} />
          </button>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5 text-xs">
        <button
          className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1 hover:bg-surface-4"
          data-testid="path-copy"
          onClick={() => void copyPath(shape)}
        >
          <Icon icon={ClipboardCopy} size={14} />
          {t('shapes.copyPath')}
        </button>
        <button
          className="inline-flex items-center gap-1 rounded-md bg-surface-3 px-2 py-1 hover:bg-surface-4"
          title={t('shapes.replacePathHint')}
          data-testid="path-replace"
          onClick={() => void replacePath(clipId)}
        >
          <Icon icon={ClipboardPaste} size={14} />
          {t('shapes.replacePath')}
        </button>
      </div>
      <p className="text-[11px] text-neutral-400">{t('shapes.pathHint')}</p>
    </div>
  );
}

async function copyPath(shape: ShapeProps) {
  if (!shape.path) return;
  try {
    await navigator.clipboard.writeText(toPathData(shape.path.value, !!shape.closed));
    showToast(i18n.t('shapes.pathCopied'));
  } catch {
    showToast(i18n.t('shapes.clipboardBlocked'));
  }
}

/** The path's points from SVG path data on the clipboard (or typed in, when the clipboard is blocked). */
async function replacePath(clipId: ID) {
  let text: string | null;
  try {
    text = await navigator.clipboard.readText();
  } catch {
    text = window.prompt(i18n.t('shapes.replacePathPrompt'));
  }
  if (!text) return;
  const err = setShapePathData(clipId, text);
  if (err) showToast(i18n.t('shapes.badPath', { error: err }));
}
