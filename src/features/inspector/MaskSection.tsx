import { useTranslation } from 'react-i18next';
import type { Clip, Mask, Project } from '../../model/types';
import type { SetFn } from './ClipInspector';
import { NumberField, Section, Segmented } from './controls';

/** An adjustment layer's mask: limit its effects to a rectangle or ellipse (placed by its transform). */
export function MaskSection({ project, clip, set }: { project: Project; clip: Clip; set: SetFn }) {
  const { t } = useTranslation();
  const { width: W, height: H } = project.settings;
  const mask = clip.mask;
  const max = 4 * Math.max(W, H);
  const setMask = <K extends keyof Mask>(key: K, v: Mask[K]) => set(`mask.${key}`, (c) => void (c.mask && (c.mask[key] = v)));
  return (
    <Section title={t('mask.title')}>
      <Segmented
        label={t('mask.shape')}
        value={mask?.kind ?? 'none'}
        options={(['none', 'rectangle', 'ellipse'] as const).map((k) => ({ value: k, label: t(`mask.${k}`) }))}
        onChange={(v) =>
          set('mask.kind', (c) => {
            if (v === 'none') delete c.mask;
            else if (c.mask) c.mask.kind = v;
            else c.mask = { kind: v, width: Math.round(W * 0.4), height: Math.round(H * 0.4), feather: 0 };
          })
        }
      />
      {mask && (
        <>
          <NumberField label={t('mask.width')} value={mask.width} min={4} max={max} step={1} unit="px" onChange={(v) => setMask('width', v)} />
          <NumberField label={t('mask.height')} value={mask.height} min={4} max={max} step={1} unit="px" onChange={(v) => setMask('height', v)} />
          <NumberField label={t('mask.feather')} value={mask.feather} min={0} max={300} step={1} unit="px" onChange={(v) => setMask('feather', v)} />
        </>
      )}
    </Section>
  );
}
