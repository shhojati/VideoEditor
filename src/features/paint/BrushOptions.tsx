import { useTranslation } from 'react-i18next';
import { ColorField, NumberField, SelectField } from '../inspector/controls';
import { setBrush, useTool } from '../tools/toolService';

/** Brush settings beside the tool strip while the brush or eraser is active (After Effects' Paint panel). */
export function BrushOptions() {
  const { t } = useTranslation();
  const tool = useTool((s) => s.tool);
  const b = useTool((s) => s.brush);
  const erasing = tool === 'eraser';
  return (
    <div
      data-testid="brush-options"
      aria-label={t('paint.options')}
      role="group"
      className="w-60 space-y-1.5 rounded border border-line bg-surface-2/95 p-2 text-xs shadow-lg"
    >
      {!erasing && <ColorField label={t('paint.color')} value={b.color} onChange={(v) => v && setBrush({ color: v })} />}
      <NumberField label={t('paint.size')} value={b.size} min={1} max={400} step={1} unit="px" onChange={(v) => setBrush({ size: Math.round(v) })} />
      <NumberField label={t('paint.hardness')} value={b.hardness} min={0} max={1} factor={100} unit="%" onChange={(v) => setBrush({ hardness: v })} />
      <NumberField label={t('paint.opacity')} value={b.opacity} min={0.05} max={1} factor={100} unit="%" onChange={(v) => setBrush({ opacity: v })} />
      <SelectField
        label={t('paint.duration')}
        value={b.duration}
        options={(['constant', 'frame', 'custom'] as const).map((value) => ({ value, label: t(`paint.durations.${value}`) }))}
        onChange={(duration) => setBrush({ duration })}
      />
      {b.duration === 'custom' && (
        <NumberField label={t('paint.seconds')} value={b.seconds} min={0.1} max={60} step={0.1} unit="s" onChange={(v) => setBrush({ seconds: v })} />
      )}
      {!erasing && (
        <NumberField label={t('paint.writeOn')} value={b.writeOn} min={0} max={10} step={0.1} unit="s" onChange={(v) => setBrush({ writeOn: v })} />
      )}
      <p className="text-[11px] text-neutral-400">{t('paint.targetHint')}</p>
    </div>
  );
}
