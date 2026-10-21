import { useTranslation } from 'react-i18next';
import { FONT_CHOICES, resolveWeight } from '../../lib/fonts';
import { presetOf, SUBTITLE_PRESETS, type SubtitlePresetId } from '../../model/subtitlePresets';
import type { ID, Project, SubtitleAnimation, SubtitleStyle } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { ColorField, NumberField, Section, Segmented, SelectField } from '../inspector/controls';
import { RTL_LANGUAGES, SUBTITLE_LANGUAGES } from './subtitleActions';

const ANIMATIONS: SubtitleAnimation[] = ['none', 'karaoke', 'pop', 'single', 'typewriter'];

/** Style of a whole subtitle track (shown in the inspector when one of its cues is selected). */
export function SubtitleStyleInspector({ project, trackId }: { project: Project; trackId: ID }) {
  const { t } = useTranslation();
  const edit = useProjectStore((s) => s.edit);
  const track = project.subtitleTracks.find((x) => x.id === trackId)!;
  const style = track.style;
  const set = (prop: string, recipe: (s: SubtitleStyle) => void) =>
    edit(
      'ops.subtitleStyle',
      (p) => {
        const st = p.subtitleTracks.find((x) => x.id === trackId);
        if (st) recipe(st.style);
      },
      { mergeKey: `${trackId}:style.${prop}` },
    );
  const setKey = <K extends keyof SubtitleStyle>(k: K, v: SubtitleStyle[K]) => set(k, (s) => void (s[k] = v));
  const font = FONT_CHOICES.find((f) => f.family === style.fontFamily) ?? FONT_CHOICES[0];
  const preset = presetOf(style);
  const animation = style.animation ?? 'none';

  return (
    <div data-testid="subtitle-style">
      <div className="border-b border-line px-3 py-2 text-sm font-medium text-white">
        {t('subtitles.styleTitle', { lang: t(`subtitles.languages.${track.language}`, track.language) })}
      </div>
      <Section title={t('subtitles.presets')}>
        <div className="grid grid-cols-2 gap-1 text-xs">
          {(Object.keys(SUBTITLE_PRESETS) as SubtitlePresetId[]).map((id) => (
            <button
              key={id}
              className={`rounded px-2 py-1 ${preset === id ? 'bg-accent text-white' : 'bg-surface-3 hover:bg-[#363c49]'}`}
              onClick={() => set('preset', (s) => Object.assign(s, { ...SUBTITLE_PRESETS[id], digits: style.digits }))}
            >
              {t(`subtitles.presetNames.${id}`)}
            </button>
          ))}
        </div>
      </Section>
      <Section title={t('subtitles.textStyle')}>
        <SelectField label={t('inspector.font')} value={style.fontFamily} options={FONT_CHOICES.map((f) => ({ value: f.family, label: f.label }))} onChange={(v) => set('font', (s) => {
          s.fontFamily = v;
          s.fontWeight = resolveWeight(v, s.fontWeight ?? 600);
        })} />
        {font.weights.length > 1 && (
          <SelectField label={t('inspector.weight')} value={resolveWeight(style.fontFamily, style.fontWeight ?? 600)} options={font.weights.map((w) => ({ value: w, label: t(`inspector.weights.${w}`, String(w)) }))} onChange={(v) => setKey('fontWeight', v)} />
        )}
        <NumberField label={t('inspector.size')} value={style.fontSize} min={16} max={140} step={1} unit="px" onChange={(v) => setKey('fontSize', v)} />
        <ColorField label={t('inspector.color')} value={style.color} onChange={(v) => setKey('color', v ?? '#ffffff')} />
        <ColorField label={t('inspector.stroke')} optional fallback="#000000" value={style.strokeColor} onChange={(v) => set('stroke', (s) => {
          s.strokeColor = v;
          if (v && !s.strokeWidth) s.strokeWidth = 5;
        })} />
        {style.strokeColor && <NumberField label={t('inspector.strokeWidth')} value={style.strokeWidth ?? 0} min={0} max={16} step={0.5} unit="px" onChange={(v) => setKey('strokeWidth', v)} />}
        <ColorField label={t('inspector.background')} optional fallback="#000000" value={style.bgColor} onChange={(v) => setKey('bgColor', v)} />
        {style.bgColor && <NumberField label={t('subtitles.bgOpacity')} value={style.bgOpacity ?? 0.6} min={0} max={1} factor={100} unit="%" onChange={(v) => setKey('bgOpacity', v)} />}
      </Section>
      <Section title={t('subtitles.layout')}>
        <Segmented label={t('subtitles.position')} value={style.position} options={(['top', 'middle', 'bottom'] as const).map((p) => ({ value: p, label: t(`subtitles.positions.${p}`) }))} onChange={(v) => setKey('position', v)} />
        <NumberField label={t('subtitles.margin')} value={style.marginY} min={0} max={400} step={1} unit="px" onChange={(v) => setKey('marginY', v)} />
        <NumberField label={t('inspector.maxWidth')} value={style.maxWidthPct} min={30} max={100} step={1} unit="%" onChange={(v) => setKey('maxWidthPct', v)} />
        <Segmented label={t('subtitles.digits')} value={style.digits ?? 'keep'} options={(['keep', 'persian', 'latin'] as const).map((d) => ({ value: d, label: t(`subtitles.digitModes.${d}`) }))} onChange={(v) => setKey('digits', v)} />
      </Section>
      <Section title={t('subtitles.animationSection')}>
        <SelectField
          label={t('subtitles.animation')}
          value={animation}
          options={ANIMATIONS.map((a) => ({ value: a, label: t(`subtitles.animations.${a}`) }))}
          onChange={(v) => set('animation', (s) => {
            s.animation = v;
            if (v !== 'none' && !s.highlightColor) s.highlightColor = '#ffe14d';
          })}
        />
        {animation !== 'none' && animation !== 'typewriter' && (
          <>
            <ColorField label={t('subtitles.highlightColor')} value={style.highlightColor ?? '#ffe14d'} onChange={(v) => setKey('highlightColor', v ?? '#ffe14d')} />
            {animation === 'karaoke' && (
              <ColorField label={t('subtitles.highlightBg')} optional fallback="#7c3aed" value={style.highlightBg} onChange={(v) => setKey('highlightBg', v)} />
            )}
            <NumberField label={t('subtitles.activeScale')} value={style.activeScale ?? 1} min={1} max={2} factor={100} unit="%" onChange={(v) => setKey('activeScale', v)} />
          </>
        )}
        {animation !== 'none' && !track.cues.some((c) => c.words?.length) && (
          <p className="text-[11px] text-neutral-400">{t('subtitles.estimatedTiming')}</p>
        )}
      </Section>
      <Section title={t('subtitles.languageSection')}>
        <SelectField
          label={t('subtitles.language')}
          value={track.language}
          options={SUBTITLE_LANGUAGES.map((l) => ({ value: l as string, label: t(`subtitles.languages.${l}`) }))}
          onChange={(v) =>
            edit('ops.subtitleLanguage', (p) => {
              const st = p.subtitleTracks.find((x) => x.id === trackId);
              if (!st) return;
              st.language = v;
              st.rtl = RTL_LANGUAGES.includes(v);
            })
          }
        />
        <Segmented
          label={t('inspector.direction')}
          value={track.rtl ? 'rtl' : 'ltr'}
          options={[
            { value: 'rtl', label: t('inspector.rtl') },
            { value: 'ltr', label: t('inspector.ltr') },
          ]}
          onChange={(v) =>
            edit('ops.subtitleLanguage', (p) => {
              const st = p.subtitleTracks.find((x) => x.id === trackId);
              if (st) st.rtl = v === 'rtl';
            })
          }
        />
      </Section>
    </div>
  );
}
