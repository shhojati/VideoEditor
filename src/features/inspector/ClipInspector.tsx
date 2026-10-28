import { Lock, Snowflake } from 'lucide-react';
import { Icon } from '../../app/icons';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { detectRtl } from '../../engine/render/textLayout';
import { DEFAULT_TEXT_MAX_WIDTH } from '../../engine/render/text';
import { fontChoices, resolveWeight } from '../../lib/fonts';
import { FontField } from '../fonts/FontField';
import { findClip } from '../../model/timeline';
import type { BlendMode, Clip, ID, Project, TextAnimKind, TextProps, Transform } from '../../model/types';
import { DEFAULT_ANIM_DURATION, TEXT_ANIMS } from '../../model/textAnim';
import { keyTimeAt } from '../../model/remap';
import { currentProject, useProjectStore, useRootProject } from '../../store/projectStore';
import { ColorField, FADE_PRESETS, NumberField, Section, Segmented, SelectField } from './controls';
import { ShapeSection } from './ShapeSection';
import { EffectsSection } from './EffectsSection';
import { isPixelBlend } from '../../engine/render/blend';
import { BLEND_GROUPS, isOverlay, isPaintLayer } from '../../model/overlays';
import { parentCandidates, setParent } from '../timeline/parentActions';
import { PaintSection } from '../paint/PaintSection';
import { MotionSection, TrackingSection } from '../tracking/TrackingSection';
import { MasksSection } from '../masks/MasksSection';
import { keyedClip } from '../../model/keyframes';
import { useTransport } from '../../store/transport';
import { keyedEdit, playheadIn } from '../keyframes/keyframeService';
import { KeyframesSection } from '../keyframes/KeyframesSection';
import { VoiceSection } from './VoiceSection';
import { CleanupSection } from './CleanupSection';
import { BeatsSection } from './BeatsSection';
import { SpeedSection } from './SpeedSection';
import { CompoundSection } from './CompoundSection';
import { ReframeSection } from '../tracking/ReframeSection';
import { DUCK_DEFAULTS } from '../../engine/audio/ducking';
import { resetClipSection } from './resetActions';

/**
 * Edit one property of one clip, as it looks at the playhead (on an animated clip the change lands
 * in a keyframe there). Continuous changes of the same property (slider drags, typing) collapse
 * into a single undo step via mergeKey; on an animated clip, one per keyframe time.
 */
function useClipEditor(clipId: ID) {
  const edit = useProjectStore((s) => s.edit);
  return (prop: string, recipe: (clip: Clip, p: Project) => void) => {
    const now = currentProject();
    const clip = now && findClip(now, clipId)?.clip;
    const at = clip?.keyframes?.length ? `@${playheadIn(clip).toFixed(3)}` : '';
    edit(
      'ops.clipProp',
      (p) => {
        const ref = findClip(p, clipId);
        if (ref && !ref.track.locked) keyedEdit(p, ref.clip, (c) => recipe(c, p));
      },
      { mergeKey: `${clipId}:${prop}${at}` },
    );
  };
}

/** The playhead for the inspector; while playing it keeps the last paused time instead of re-rendering on every tick. */
function useInspectorTime() {
  const time = useTransport((s) => (s.playing ? null : s.time));
  const [last, setLast] = useState(0);
  if (time !== null && time !== last) setLast(time);
  return time ?? last;
}

export function ClipInspector({ project, clipId }: { project: Project; clipId: ID }) {
  const { t } = useTranslation();
  const ref = findClip(project, clipId)!;
  const { clip, track } = ref;
  const asset = clip.assetId ? project.assets[clip.assetId] : undefined;
  const set = useClipEditor(clipId);
  const time = useInspectorTime();
  // Values as they are at the playhead (keyframes applied).
  const shown = keyedClip(clip, playheadIn(clip, time));
  const isText = !!clip.text;
  const compound = !!clip.sequenceId;
  // A video's detached sound (on an audio track) is audio only; the silent video is picture only.
  const visual = track.kind !== 'audio' && (isOverlay(clip) || compound || asset?.kind === 'video' || asset?.kind === 'image');
  const timed = asset?.kind === 'video' || asset?.kind === 'audio';
  const audible = !clip.audioDetached && (asset?.kind === 'audio' || (asset?.kind === 'video' && asset.hasAudio));
  const setTransform = <K extends keyof Transform>(key: K, v: Transform[K]) =>
    set(`transform.${key}`, (c) => void (c.transform[key] = v));

  return (
    <fieldset disabled={track.locked} className="min-w-0 disabled:opacity-60" data-testid="clip-inspector">
      <div className="truncate border-b border-line px-3 py-2 text-sm font-medium text-white" dir="auto">
        {clip.adjustment ? t('effects.adjustment') : isText ? t('inspector.textClip') : clip.shape ? t('inspector.shapeClip') : isPaintLayer(clip) ? `🖌 ${t('paint.layer')}` : clip.solid ? `■ ${t('shapes.solid')}` : clip.nullObject ? `⌖ ${t('shapes.null')}` : compound ? `▣ ${project.sequences?.[clip.sequenceId!]?.name ?? ''}` : asset?.name}
        {track.locked && (
          <span className="ms-2 inline-flex items-center gap-1 text-xs text-amber-400">
            <Icon icon={Lock} size={12} />
            {t('inspector.locked')}
          </span>
        )}
        {clip.freeze && (
          <p className="flex items-center gap-1 text-[11px] font-normal text-sky-300" data-testid="freeze-note">
            <Icon icon={Snowflake} size={12} />
            {t('speed.freezeNote')}
          </p>
        )}
      </div>

      {/* What the clip is first, then the owner's order: transform, effects, masks, speed, keyframes,
          motion tracking, audio, paint. */}
      {compound && <CompoundSection project={project} clip={clip} />}
      {isText && <TextSection clipId={clipId} text={shown.text!} set={set} />}
      {clip.solid && (
        <Section id="solid" title={t('shapes.solid')}>
          <ColorField alpha label={t('inspector.fill')} value={clip.solid.color} onChange={(v) => v && set('solid.color', (c) => void (c.solid!.color = v))} />
        </Section>
      )}
      {clip.shape && (
        <ShapeSection
          clipId={clipId}
          shape={shown.shape!}
          set={set}
          maxSize={4 * Math.max(project.settings.width, project.settings.height)}
          keyAt={keyTimeAt(clip, playheadIn(clip, time))}
          fps={project.settings.fps}
        />
      )}

      {clip.adjustment && !clip.masks?.length && (
        <Section id="transform" title={t('inspector.transform')} onReset={() => resetClipSection(clipId, 'transform')}>
          <NumberField label={t('inspector.opacity')} value={shown.transform.opacity} min={0} max={1} factor={100} unit="%" onChange={(v) => setTransform('opacity', v)} />
          <BlendField clip={clip} set={set} />
        </Section>
      )}

      {visual && (!clip.adjustment || !!clip.masks?.length) && (
        <Section id="transform" title={t('inspector.transform')} onReset={() => resetClipSection(clipId, 'transform')}>
          <NumberField label={t('inspector.x')} value={shown.transform.x} min={-0.5} max={0.5} factor={100} unit="%" onChange={(v) => setTransform('x', v)} />
          <NumberField label={t('inspector.y')} value={shown.transform.y} min={-0.5} max={0.5} factor={100} unit="%" onChange={(v) => setTransform('y', v)} />
          <NumberField label={t('inspector.scale')} value={shown.transform.scale} min={0.1} max={4} factor={100} unit="%" onChange={(v) => setTransform('scale', v)} />
          <NumberField label={t('inspector.rotation')} value={shown.transform.rotation} min={-180} max={180} step={1} unit="°" onChange={(v) => setTransform('rotation', v)} />
          {!clip.nullObject && (
            <NumberField label={t('inspector.opacity')} value={shown.transform.opacity} min={0} max={1} factor={100} unit="%" onChange={(v) => setTransform('opacity', v)} />
          )}
          {!clip.nullObject && <BlendField clip={clip} set={set} />}
          <ParentField project={project} clip={clip} />
          {!isOverlay(clip) && (
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

      {visual && <EffectsSection clip={shown} asset={asset} set={set} />}
      {visual && !compound && <MasksSection project={project} clip={clip} />}
      {timed && asset && !clip.freeze && <SpeedSection clip={clip} asset={asset} audible={!!audible} visual={visual} set={set} />}
      {(visual || audible) && <KeyframesSection project={project} clip={clip} time={time} />}

      {visual && (
        <Section id="motionTracking" title={t('inspector.motionTracking')}>
          <MotionSection project={project} clip={clip} />
          {asset?.kind === 'video' && <TrackingSection project={project} clip={clip} />}
          {asset?.kind === 'video' && <ReframeSection project={project} clip={clip} />}
        </Section>
      )}

      {(audible || compound) && (
        <Section id="audio" title={t('inspector.audio')} onReset={() => resetClipSection(clipId, 'audio')}>
          <NumberField label={t('inspector.volume')} value={shown.audio.volume} min={0} max={2} factor={100} unit="%" onChange={(v) => set('volume', (c) => void (c.audio.volume = v))} />
          <NumberField label={t('inspector.fadeIn')} value={clip.audio.fadeIn} min={0} max={Math.min(5, clip.duration)} step={0.1} unit="s" onChange={(v) => set('afadeIn', (c) => void (c.audio.fadeIn = v))} />
          <NumberField label={t('inspector.fadeOut')} value={clip.audio.fadeOut} min={0} max={Math.min(5, clip.duration)} step={0.1} unit="s" onChange={(v) => set('afadeOut', (c) => void (c.audio.fadeOut = v))} />
          <label className="flex items-center gap-2 text-xs text-neutral-300" title={t('inspector.duckHint')}>
            <input
              type="checkbox"
              data-testid="duck-toggle"
              checked={!!clip.audio.duck}
              onChange={(e) => {
                const on = e.target.checked;
                set('duck', (c) => {
                  if (on) c.audio.duck = { ...DUCK_DEFAULTS };
                  else delete c.audio.duck;
                });
              }}
            />
            {t('inspector.duck')}
          </label>
          {clip.audio.duck && (
            <>
              <NumberField label={t('inspector.duckAmount')} value={clip.audio.duck.amount} min={-30} max={0} step={1} unit="dB" onChange={(v) => set('duckAmount', (c) => void (c.audio.duck!.amount = v))} />
              <NumberField label={t('inspector.duckAttack')} value={clip.audio.duck.attack} min={0.05} max={2} step={0.05} unit="s" onChange={(v) => set('duckAttack', (c) => void (c.audio.duck!.attack = v))} />
              <NumberField label={t('inspector.duckRelease')} value={clip.audio.duck.release} min={0.05} max={3} step={0.05} unit="s" onChange={(v) => set('duckRelease', (c) => void (c.audio.duck!.release = v))} />
              <p className="text-[11px] text-neutral-400">{t('inspector.duckHint')}</p>
            </>
          )}
          {audible && <CleanupSection project={project} clip={clip} set={set} />}
          {audible && <VoiceSection clip={shown} set={set} />}
          {audible && asset && <BeatsSection clip={clip} asset={asset} />}
        </Section>
      )}

      {clip.paint && <PaintSection project={project} clip={clip} />}
    </fieldset>
  );
}

export type SetFn = ReturnType<typeof useClipEditor>;

/** Blend mode picker (under Opacity in Transform), grouped as in After Effects. */
function BlendField({ clip, set }: { clip: Clip; set: SetFn }) {
  const { t } = useTranslation();
  const mode = clip.blend ?? 'normal';
  return (
    <>
      <label className="flex flex-col gap-1 text-xs">
        <span className="text-neutral-400">{t('blend.label')}</span>
        <select
          data-testid="blend-mode"
          className="min-w-0 rounded bg-surface-3 px-2 py-1"
          value={mode}
          onChange={(e) => {
            const v = e.target.value as BlendMode;
            set('blend', (c) => void (c.blend = v === 'normal' ? undefined : v));
          }}
        >
          {BLEND_GROUPS.map((group, i) => [
            i > 0 && (
              <option key={`sep${i}`} disabled>
                ──────────
              </option>
            ),
            ...group.map((m) => (
              <option key={m} value={m}>
                {t(`blend.${m}`)}
              </option>
            )),
          ])}
        </select>
      </label>
      {isPixelBlend(mode) && <p className="text-[11px] text-neutral-400">{t('blend.slowHint')}</p>}
    </>
  );
}

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

function TextSection({ clipId, text, set }: { clipId: ID; text: TextProps; set: SetFn }) {
  const { t } = useTranslation();
  const setText = <K extends keyof TextProps>(key: K, v: TextProps[K]) => set(`text.${key}`, (c) => void (c.text![key] = v));
  const choices = fontChoices(useRootProject()?.fonts);
  const font = choices.find((f) => f.family === text.fontFamily) ?? choices[0];
  const preset = FADE_PRESETS.find((p) => p.value === text.fadeIn && p.value === text.fadeOut)?.key ?? 'custom';

  return (
    <Section id="text" title={t('inspector.text')} onReset={() => resetClipSection(clipId, 'text')}>
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
      <FontField
        label={t('inspector.font')}
        value={text.fontFamily}
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
      <ColorField alpha label={t('inspector.color')} value={text.color} onChange={(v) => setText('color', v ?? '#ffffff')} />
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
      <ColorField alpha label={t('inspector.background')} optional fallback="#000000" value={text.bgColor} onChange={(v) => setText('bgColor', v)} />
      <ColorField alpha label={t('inspector.stroke')} optional fallback="#000000" value={text.strokeColor} onChange={(v) => set('text.strokeColor', (c) => {
        c.text!.strokeColor = v;
        if (v && !c.text!.strokeWidth) c.text!.strokeWidth = 4;
      })} />
      {text.strokeColor && (
        <NumberField label={t('inspector.strokeWidth')} value={text.strokeWidth ?? 0} min={0} max={24} step={0.5} unit="px" onChange={(v) => setText('strokeWidth', v)} />
      )}
      <ColorField alpha label={t('inspector.shadow')} optional fallback="#000000" value={text.shadowColor} onChange={(v) => set('text.shadowColor', (c) => {
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
      {(['in', 'out'] as const).map((side) => (
        <SelectField
          key={side}
          label={t(`textAnim.${side}`)}
          value={text.anim?.[side] ?? 'none'}
          options={[{ value: 'none', label: t('textAnim.kinds.none') }, ...TEXT_ANIMS.map((k) => ({ value: k, label: t(`textAnim.kinds.${k}`) }))]}
          onChange={(v) =>
            set(`text.anim.${side}`, (c) => {
              const anim = { ...c.text!.anim };
              if (v === 'none') delete anim[side];
              else anim[side] = v as TextAnimKind;
              if (anim.in || anim.out) c.text!.anim = anim;
              else delete c.text!.anim;
            })
          }
        />
      ))}
      {(text.anim?.in || text.anim?.out) && (
        <NumberField
          label={t('textAnim.duration')}
          value={text.anim.duration ?? DEFAULT_ANIM_DURATION}
          min={0.1}
          max={3}
          step={0.1}
          unit="s"
          onChange={(v) => set('text.anim.duration', (c) => void (c.text!.anim = { ...c.text!.anim, duration: v }))}
        />
      )}
    </Section>
  );
}

/** Display name of a clip in the parent picker. */
function clipLabel(project: Project, clip: Clip, t: (k: string) => string) {
  if (clip.nullObject) return `⌖ ${t('shapes.null')}`;
  if (clip.solid) return `■ ${t('shapes.solid')}`;
  if (clip.adjustment) return t('effects.adjustment');
  if (clip.text) return clip.text.content.split('\n')[0].slice(0, 24) || t('inspector.textClip');
  if (clip.shape) return t(`shapes.${clip.shape.kind}`);
  if (isPaintLayer(clip)) return `🖌 ${t('paint.layer')}`;
  if (clip.sequenceId) return `▣ ${project.sequences?.[clip.sequenceId]?.name ?? ''}`;
  return (clip.assetId && project.assets[clip.assetId]?.name) || '?';
}

/** After Effects' Parent & Link: the clip moves, turns and scales with the chosen clip. */
function ParentField({ project, clip }: { project: Project; clip: Clip }) {
  const { t } = useTranslation();
  const options = parentCandidates(project, clip);
  // Same names (two clips of one video) get their start time to tell them apart.
  const label = (c: Clip) => `${clipLabel(project, c, t)} · ${c.start.toFixed(1)}s`;
  return (
    <SelectField
      label={`🔗 ${t('inspector.parent')}`}
      value={clip.parentId ?? ''}
      options={[{ value: '', label: t('inspector.noParent') }, ...options.map((c) => ({ value: c.id, label: label(c) }))]}
      onChange={(v) => setParent(clip.id, v || null)}
    />
  );
}
