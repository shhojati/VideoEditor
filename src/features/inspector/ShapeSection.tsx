import { useTranslation } from 'react-i18next';
import { keepsAspect, setShapeKind, SHAPE_KINDS } from '../../model/overlays';
import type { ShapeProps } from '../../model/types';
import { SHAPE_ICONS } from '../shapes/shapesUi';
import type { SetFn } from './ClipInspector';
import { ColorField, FADE_PRESETS, NumberField, Section, Segmented, SelectField } from './controls';

/** Shape type, size, fill, stroke (colour, width, opacity, dashes), corners, star, arrows, shadow, fades. */
export function ShapeSection({ shape, set, maxSize }: { shape: ShapeProps; set: SetFn; maxSize: number }) {
  const { t } = useTranslation();
  const setShape = <K extends keyof ShapeProps>(key: K, v: ShapeProps[K]) => set(`shape.${key}`, (c) => void (c.shape![key] = v));
  const isLine = shape.kind === 'line';
  const square = keepsAspect(shape.kind);
  const hasStroke = isLine || !!shape.stroke;
  const preset = FADE_PRESETS.find((p) => p.value === shape.fadeIn && p.value === shape.fadeOut)?.key ?? 'custom';

  return (
    <Section title={t('inspector.shape')}>
      <SelectField
        label={t('inspector.kind')}
        value={shape.kind}
        options={SHAPE_KINDS.map((k) => ({ value: k, label: `${SHAPE_ICONS[k]} ${t(`shapes.${k}`)}` }))}
        onChange={(v) => set('shape.kind', (c) => setShapeKind(c.shape!, v))}
      />
      <NumberField
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
      />
      {!isLine && !square && (
        <NumberField label={t('inspector.height')} value={shape.height} min={4} max={maxSize} step={1} unit="px" onChange={(v) => setShape('height', v)} />
      )}

      {!isLine && (
        <>
          <ColorField label={t('inspector.fill')} optional fallback="#2563eb" value={shape.fill} onChange={(v) => setShape('fill', v)} />
          {shape.fill && (
            <NumberField label={t('inspector.fillOpacity')} value={shape.fillOpacity ?? 1} min={0} max={1} factor={100} unit="%" onChange={(v) => setShape('fillOpacity', v)} />
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
        </>
      )}

      {(shape.kind === 'rectangle' || shape.kind === 'square' || shape.kind === 'triangle') && (
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
      {isLine && (
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
        <NumberField label={t('inspector.shadowBlur')} value={shape.shadowBlur ?? 0} min={0} max={80} step={1} unit="px" onChange={(v) => setShape('shadowBlur', v)} />
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
