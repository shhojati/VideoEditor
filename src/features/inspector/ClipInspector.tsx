import { useTranslation } from 'react-i18next';
import { detectRtl } from '../../engine/render/textLayout';
import { DEFAULT_TEXT_MAX_WIDTH } from '../../engine/render/text';
import { FONT_CHOICES, resolveWeight } from '../../lib/fonts';
import { findClip, moveClips, SPEED_RANGE, setClipSpeed, trimClip } from '../../model/timeline';
import type { Clip, ID, Project, TextProps, Transform } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { ColorField, NumberField, Section, Segmented, SelectField } from './controls';

/**
 * Edit one property of one clip. Continuous changes of the same property (slider drags, typing)
 * collapse into a single undo step via mergeKey.
 */
function useClipEditor(clipId: ID) {
  const edit = useProjectStore((s) => s.edit);
  return (prop: string, recipe: (clip: Clip, p: Project) => void) =>
    edit(
      'ops.clipProp',
      (p) => {
        const ref = findClip(p, clipId);
        if (ref && !ref.track.locked) recipe(ref.clip, p);
      },
      { mergeKey: `${clipId}:${prop}` },
    );
}

export function ClipInspector({ project, clipId }: { project: Project; clipId: ID }) {
  const { t } = useTranslation();
  const ref = findClip(project, clipId)!;
  const { clip, track } = ref;
  const asset = clip.assetId ? project.assets[clip.assetId] : undefined;
  const set = useClipEditor(clipId);
  const isText = !!clip.text;
  const visual = isText || asset?.kind === 'video' || asset?.kind === 'image';
  const timed = asset?.kind === 'video' || asset?.kind === 'audio';
  const audible = asset?.kind === 'audio' || (asset?.kind === 'video' && asset.hasAudio);
  const setTransform = <K extends keyof Transform>(key: K, v: Transform[K]) =>
    set(`transform.${key}`, (c) => void (c.transform[key] = v));

  return (
    <fieldset disabled={track.locked} className="min-w-0 disabled:opacity-60" data-testid="clip-inspector">
      <div className="truncate border-b border-line px-3 py-2 text-sm font-medium text-white" dir="auto">
        {isText ? t('inspector.textClip') : asset?.name}
        {track.locked && <span className="ms-2 text-xs text-amber-400">🔒 {t('inspector.locked')}</span>}
      </div>

      <Section title={t('inspector.timing')}>
        <NumberField
          label={t('inspector.start')}
          value={clip.start}
          min={0}
          max={Math.max(clip.start + 600, 3600)}
          step={1 / project.settings.fps}
          unit="s"
          onChange={(v) =>
            // Only free spots are accepted; moveClips keeps the track sorted.
            set('start', (c, p) => void moveClips(p, [{ clipId: c.id, trackId: track.id, start: v }]))
          }
        />
        <NumberField
          label={t('inspector.duration')}
          value={clip.duration}
          min={0.1}
          max={Math.max(clip.duration * 4, 60)}
          step={1 / project.settings.fps}
          unit="s"
          onChange={(v) => set('duration', (c, p) => void trimClip(p, c.id, 'end', c.start + v))}
        />
        {timed && (
          <>
            <NumberField
              label={t('inspector.speed')}
              value={clip.speed}
              min={SPEED_RANGE.min}
              max={SPEED_RANGE.max}
              step={0.05}
              unit="×"
              onChange={(v) => set('speed', (c, p) => void setClipSpeed(p, c.id, v))}
            />
            <Segmented
              label=""
              value={clip.speed}
              options={[0.5, 1, 1.5, 2].map((s) => ({ value: s, label: `${s}×` }))}
              onChange={(v) => set('speed', (c, p) => void setClipSpeed(p, c.id, v))}
            />
          </>
        )}
      </Section>

      {isText && <TextSection text={clip.text!} set={set} />}

      {visual && (
        <Section title={t('inspector.transform')}>
          <NumberField label={t('inspector.x')} value={clip.transform.x} min={-0.5} max={0.5} factor={100} unit="%" onChange={(v) => setTransform('x', v)} />
          <NumberField label={t('inspector.y')} value={clip.transform.y} min={-0.5} max={0.5} factor={100} unit="%" onChange={(v) => setTransform('y', v)} />
          <NumberField label={t('inspector.scale')} value={clip.transform.scale} min={0.1} max={4} factor={100} unit="%" onChange={(v) => setTransform('scale', v)} />
          <NumberField label={t('inspector.rotation')} value={clip.transform.rotation} min={-180} max={180} step={1} unit="°" onChange={(v) => setTransform('rotation', v)} />
          <NumberField label={t('inspector.opacity')} value={clip.transform.opacity} min={0} max={1} factor={100} unit="%" onChange={(v) => setTransform('opacity', v)} />
          {!isText && (
            <>
              <Segmented
                label={t('inspector.fit')}
                value={clip.transform.fit ?? 'contain'}
                options={[
                  { value: 'contain', label: t('transport.fit') },
                  { value: 'cover', label: t('transport.fill') },
                ]}
                onChange={(v) => setTransform('fit', v)}
              />
              <CropFields clip={clip} set={set} />
            </>
          )}
        </Section>
      )}

      {audible && (
        <Section title={t('inspector.audio')}>
          <NumberField label={t('inspector.volume')} value={clip.audio.volume} min={0} max={2} factor={100} unit="%" onChange={(v) => set('volume', (c) => void (c.audio.volume = v))} />
          <NumberField label={t('inspector.fadeIn')} value={clip.audio.fadeIn} min={0} max={Math.min(5, clip.duration)} step={0.1} unit="s" onChange={(v) => set('afadeIn', (c) => void (c.audio.fadeIn = v))} />
          <NumberField label={t('inspector.fadeOut')} value={clip.audio.fadeOut} min={0} max={Math.min(5, clip.duration)} step={0.1} unit="s" onChange={(v) => set('afadeOut', (c) => void (c.audio.fadeOut = v))} />
        </Section>
      )}
    </fieldset>
  );
}

type SetFn = ReturnType<typeof useClipEditor>;

function CropFields({ clip, set }: { clip: Clip; set: SetFn }) {
  const { t } = useTranslation();
  const crop = clip.transform.crop ?? { x: 0, y: 0, width: 1, height: 1 };
  const edges = { left: crop.x, top: crop.y, right: 1 - crop.x - crop.width, bottom: 1 - crop.y - crop.height };
  const setEdge = (edge: keyof typeof edges, v: number) =>
    set(`crop.${edge}`, (c) => {
      const e = { ...edges, [edge]: v };
      // Keep at least 10% visible in each direction.
      if (e.left + e.right > 0.9 || e.top + e.bottom > 0.9) return;
      const full = !e.left && !e.top && !e.right && !e.bottom;
      c.transform.crop = full ? undefined : { x: e.left, y: e.top, width: 1 - e.left - e.right, height: 1 - e.top - e.bottom };
    });
  return (
    <>
      {(['left', 'right', 'top', 'bottom'] as const).map((edge) => (
        <NumberField
          key={edge}
          label={t(`inspector.crop.${edge}`)}
          value={edges[edge]}
          min={0}
          max={0.45}
          factor={100}
          unit="%"
          onChange={(v) => setEdge(edge, v)}
        />
      ))}
    </>
  );
}

const FADE_PRESETS = [
  { key: 'none', value: 0 },
  { key: 'quick', value: 0.3 },
  { key: 'slow', value: 1 },
] as const;

function TextSection({ text, set }: { text: TextProps; set: SetFn }) {
  const { t } = useTranslation();
  const setText = <K extends keyof TextProps>(key: K, v: TextProps[K]) => set(`text.${key}`, (c) => void (c.text![key] = v));
  const font = FONT_CHOICES.find((f) => f.family === text.fontFamily) ?? FONT_CHOICES[0];
  const preset = FADE_PRESETS.find((p) => p.value === text.fadeIn && p.value === text.fadeOut)?.key ?? 'custom';

  return (
    <Section title={t('inspector.text')}>
      <textarea
        dir="auto"
        rows={3}
        data-testid="text-content"
        aria-label={t('inspector.content')}
        className="w-full resize-y rounded bg-surface-3 p-2 text-sm"
        style={{ fontFamily: `"${text.fontFamily}", Vazirmatn` }}
        value={text.content}
        onChange={(e) => {
          const content = e.target.value;
          set('text.content', (c) => {
            // Direction follows the text (first strong character) unless the user overrode it,
            // i.e. unless the current direction already disagrees with the old content.
            const t0 = c.text!;
            if (!t0.content.trim() || t0.rtl === detectRtl(t0.content)) t0.rtl = detectRtl(content);
            t0.content = content;
          });
        }}
      />
      <SelectField
        label={t('inspector.font')}
        value={text.fontFamily}
        options={FONT_CHOICES.map((f) => ({ value: f.family, label: f.label }))}
        onChange={(v) => set('text.fontFamily', (c) => {
          c.text!.fontFamily = v;
          c.text!.fontWeight = resolveWeight(v, c.text!.fontWeight);
        })}
      />
      {font.weights.length > 1 && (
        <SelectField
          label={t('inspector.weight')}
          value={resolveWeight(text.fontFamily, text.fontWeight)}
          options={font.weights.map((w) => ({ value: w, label: t(`inspector.weights.${w}`) }))}
          onChange={(v) => setText('fontWeight', v)}
        />
      )}
      <NumberField label={t('inspector.size')} value={text.fontSize} min={12} max={300} step={1} unit="px" onChange={(v) => setText('fontSize', v)} />
      <ColorField label={t('inspector.color')} value={text.color} onChange={(v) => setText('color', v ?? '#ffffff')} />
      <Segmented
        label={t('inspector.align')}
        value={text.align}
        options={[
          { value: 'left', label: '⇤', title: t('inspector.alignLeft') },
          { value: 'center', label: '↔', title: t('inspector.alignCenter') },
          { value: 'right', label: '⇥', title: t('inspector.alignRight') },
        ]}
        onChange={(v) => setText('align', v)}
      />
      <Segmented
        label={t('inspector.direction')}
        value={text.rtl ? 'rtl' : 'ltr'}
        options={[
          { value: 'rtl', label: t('inspector.rtl') },
          { value: 'ltr', label: t('inspector.ltr') },
        ]}
        onChange={(v) => setText('rtl', v === 'rtl')}
      />
      <NumberField label={t('inspector.maxWidth')} value={text.maxWidth ?? DEFAULT_TEXT_MAX_WIDTH} min={0.2} max={1} factor={100} unit="%" onChange={(v) => setText('maxWidth', v)} />
      <ColorField label={t('inspector.background')} optional fallback="#000000" value={text.bgColor} onChange={(v) => setText('bgColor', v)} />
      <ColorField label={t('inspector.stroke')} optional fallback="#000000" value={text.strokeColor} onChange={(v) => set('text.strokeColor', (c) => {
        c.text!.strokeColor = v;
        if (v && !c.text!.strokeWidth) c.text!.strokeWidth = 4;
      })} />
      {text.strokeColor && (
        <NumberField label={t('inspector.strokeWidth')} value={text.strokeWidth ?? 0} min={0} max={24} step={0.5} unit="px" onChange={(v) => setText('strokeWidth', v)} />
      )}
      <ColorField label={t('inspector.shadow')} optional fallback="#000000" value={text.shadowColor} onChange={(v) => set('text.shadowColor', (c) => {
        c.text!.shadowColor = v;
        if (v && c.text!.shadowBlur === undefined) c.text!.shadowBlur = 12;
      })} />
      {text.shadowColor && (
        <NumberField label={t('inspector.shadowBlur')} value={text.shadowBlur ?? 0} min={0} max={60} step={1} unit="px" onChange={(v) => setText('shadowBlur', v)} />
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
          if (p) set('text.fadePreset', (c) => {
            c.text!.fadeIn = p.value;
            c.text!.fadeOut = p.value;
          });
        }}
      />
      <NumberField label={t('inspector.fadeIn')} value={text.fadeIn} min={0} max={3} step={0.1} unit="s" onChange={(v) => setText('fadeIn', v)} />
      <NumberField label={t('inspector.fadeOut')} value={text.fadeOut} min={0} max={3} step={0.1} unit="s" onChange={(v) => setText('fadeOut', v)} />
    </Section>
  );
}
