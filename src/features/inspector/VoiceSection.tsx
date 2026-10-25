import { useTranslation } from 'react-i18next';
import { PITCH_RANGE, setSpace, setVoice, SPACE_KINDS, VOICE_GROUPS, VOICE_PRESETS } from '../../model/voiceFx';
import type { Clip, SpaceKind, VoiceKind } from '../../model/types';
import type { SetFn } from './ClipInspector';
import { NumberField, Section } from './controls';
import { resetClipSection } from './resetActions';

/** Voice changer and space for an audible clip: preset chips, then their sliders. `clip` = values at the playhead. */
export function VoiceSection({ clip, set }: { clip: Clip; set: SetFn }) {
  const { t } = useTranslation();
  const { voice, space } = clip.audio;
  return (
    <Section id="voice" title={t('voiceFx.title')} onReset={() => resetClipSection(clip.id, 'voice')}>
      <Chips
        label={t('voiceFx.voice')}
        testId="voice-preset"
        value={voice?.kind}
        groups={VOICE_GROUPS}
        name={(k) => t(`voiceFx.names.${k}`)}
        onPick={(k) => set('voice.kind', (c) => setVoice(c, k))}
      />
      {voice && (
        <>
          <NumberField
            label={t('voiceFx.pitch')}
            value={voice.pitch}
            min={PITCH_RANGE.min}
            max={PITCH_RANGE.max}
            step={1}
            onChange={(v) => set('voice.pitch', (c) => void (c.audio.voice && (c.audio.voice.pitch = v)))}
          />
          {VOICE_PRESETS[voice.kind].character && (
            <NumberField
              label={t('voiceFx.amount')}
              value={voice.amount}
              min={0}
              max={1}
              factor={100}
              unit="%"
              onChange={(v) => set('voice.amount', (c) => void (c.audio.voice && (c.audio.voice.amount = v)))}
            />
          )}
        </>
      )}
      <Chips
        label={t('voiceFx.space')}
        testId="space-preset"
        value={space?.kind}
        groups={[SPACE_KINDS]}
        name={(k) => t(`voiceFx.spaces.${k}`)}
        onPick={(k) => set('space.kind', (c) => setSpace(c, k))}
      />
      {space && (
        <>
          <NumberField
            label={t('voiceFx.mix')}
            value={space.mix}
            min={0}
            max={1}
            factor={100}
            unit="%"
            onChange={(v) => set('space.mix', (c) => void (c.audio.space && (c.audio.space.mix = v)))}
          />
          <NumberField
            label={t('voiceFx.size')}
            value={space.size}
            min={0}
            max={1}
            factor={100}
            unit="%"
            onChange={(v) => set('space.size', (c) => void (c.audio.space && (c.audio.space.size = v)))}
          />
        </>
      )}
    </Section>
  );
}

/** "None" plus preset buttons, wrapped in rows per group. */
function Chips<K extends VoiceKind | SpaceKind>(props: {
  label: string;
  testId: string;
  value: K | undefined;
  groups: readonly (readonly K[])[];
  name: (k: K) => string;
  onPick: (k: K | undefined) => void;
}) {
  const { t } = useTranslation();
  const chip = (k: K | undefined, text: string) => (
    <button
      key={k ?? 'none'}
      role="radio"
      aria-checked={props.value === k}
      data-testid={props.testId}
      data-kind={k ?? 'none'}
      className={`rounded border border-line px-2 py-0.5 ${props.value === k ? 'bg-accent text-on-accent' : 'bg-surface-3 text-neutral-300 hover:bg-surface-4'}`}
      onClick={() => props.onPick(k)}
    >
      {text}
    </button>
  );
  return (
    <div className="flex flex-col gap-1 text-xs">
      <span className="text-neutral-400">{props.label}</span>
      <div className="flex flex-col gap-1" role="radiogroup" aria-label={props.label}>
        <div className="flex flex-wrap gap-1">{chip(undefined, t('voiceFx.none'))}</div>
        {props.groups.map((g, i) => (
          <div key={i} className="flex flex-wrap gap-1">
            {g.map((k) => chip(k, props.name(k)))}
          </div>
        ))}
      </div>
    </div>
  );
}
