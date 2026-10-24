// The ↺ button of each Properties section: put that section's settings back to their defaults, in
// one undo step. Animated values of the section lose their keyframes too (a reset value that a
// keyframe overrides would not look reset).
import { defaultParams } from '../../model/effects';
import { ASPECT_PRESETS, DEFAULT_SUBTITLE_STYLE } from '../../model/factories';
import { defaultShape, TEXT_STYLE_DEFAULTS } from '../../model/overlays';
import { setSpeedCurve } from '../../model/speed';
import { findClip, setClipSpeed } from '../../model/timeline';
import { DEFAULT_TRANSITION_DURATION, TRANSITION_KINDS, updateTransition } from '../../model/transitions';
import type { Clip, ID, Project, SubtitleStyle } from '../../model/types';
import { setKeepPitch } from '../../model/voiceFx';
import { useProjectStore } from '../../store/projectStore';
import { setActiveMask, useMasks } from '../masks/maskService';
import { RTL_LANGUAGES } from '../subtitles/subtitleActions';
import { cancelTracking, setActiveTracker, useTracking } from '../tracking/trackingService';

/** Remove these properties (exact names, or prefixes ending in '.') from the clip's keyframes. */
function dropKeys(clip: Clip, props: readonly string[]) {
  if (!clip.keyframes) return;
  const hit = (k: string) => props.some((p) => (p.endsWith('.') ? k.startsWith(p) : k === p));
  for (const kf of clip.keyframes) for (const k of Object.keys(kf.v)) if (hit(k)) delete kf.v[k];
  clip.keyframes = clip.keyframes.filter((kf) => Object.keys(kf.v).length);
  if (!clip.keyframes.length) delete clip.keyframes;
}

function resetClip(clipId: ID, keys: readonly string[], recipe: (clip: Clip, p: Project) => void) {
  useProjectStore.getState().edit('ops.resetSection', (p) => {
    const ref = findClip(p, clipId);
    if (!ref || ref.track.locked) return;
    recipe(ref.clip, p);
    dropKeys(ref.clip, keys);
  });
}

export type ClipSection = 'speed' | 'text' | 'shape' | 'transform' | 'effects' | 'audio' | 'cleanup' | 'voice' | 'masks' | 'tracking' | 'reframe';

const TRANSFORM_KEYS = ['x', 'y', 'scale', 'rotation', 'opacity'];

export function resetClipSection(clipId: ID, section: ClipSection) {
  switch (section) {
    case 'speed':
      return resetClip(clipId, [], (c, p) => {
        if (c.speedCurve) setSpeedCurve(p, c.id, null, 'custom');
        setClipSpeed(p, c.id, 1);
        if (c.audio.keepPitch) setKeepPitch(c, false);
      });
    case 'text':
      // The words and their direction stay; the look goes back to a new text clip's.
      return resetClip(clipId, [], (c) => {
        if (c.text) c.text = { ...TEXT_STYLE_DEFAULTS, content: c.text.content, rtl: c.text.rtl };
      });
    case 'shape':
      return resetClip(clipId, ['shape.'], (c) => {
        if (c.shape) c.shape = defaultShape(c.shape.kind);
      });
    case 'transform':
      return resetClip(clipId, TRANSFORM_KEYS, (c, p) => {
        const sticker = !!c.assetId && p.assets[c.assetId]?.library?.kind === 'stickers';
        c.transform = { x: 0, y: c.text ? 0.3 : 0, scale: sticker ? 0.35 : 1, rotation: 0, opacity: 1 };
        // The blend mode sits in Transform, under Opacity.
        delete c.blend;
      });
    case 'effects':
      // Every effect keeps its place in the stack, with its default settings (a filter keeps its look).
      return resetClip(clipId, ['fx.'], (c) => {
        for (const e of c.effects ?? []) {
          e.enabled = true;
          e.params = { ...defaultParams(e.kind), ...(e.kind === 'look' ? { preset: e.params.preset } : {}) };
        }
      });
    case 'audio':
      return resetClip(clipId, ['volume'], (c) => {
        c.audio.volume = 1;
        c.audio.fadeIn = 0;
        c.audio.fadeOut = 0;
        delete c.audio.duck;
      });
    case 'cleanup':
      return resetClip(clipId, [], (c) => {
        delete c.audio.clean;
        delete c.audio.gainDb;
      });
    case 'voice':
      return resetClip(clipId, ['voice.', 'space.'], (c) => {
        delete c.audio.voice;
        delete c.audio.space;
      });
    case 'masks':
      if (useMasks.getState().active?.clipId === clipId) setActiveMask(clipId, null);
      return resetClip(clipId, [], (c) => void delete c.masks);
    case 'tracking':
      if (useTracking.getState().job?.clipId === clipId) cancelTracking();
      if (useTracking.getState().active?.clipId === clipId) setActiveTracker(clipId, null);
      return resetClip(clipId, [], (c) => {
        // A stabilize or reframe link to the clip's own tracker goes with it.
        if (c.motion && c.trackers?.some((x) => x.id === c.motion!.trackerId)) delete c.motion;
        delete c.trackers;
      });
    case 'reframe':
      return resetClip(clipId, [], (c) => {
        if (c.motion?.mode !== 'reframe') return;
        const id = c.motion.trackerId;
        delete c.motion;
        c.trackers = c.trackers?.filter((x) => x.id !== id);
        if (!c.trackers?.length) delete c.trackers;
        delete c.transform.fit;
      });
  }
}

/** Project settings as a new project starts (16:9, 30 fps, no platform). */
export function resetProjectSettings() {
  useProjectStore.getState().edit('ops.resetSection', (p) => {
    Object.assign(p.settings, ASPECT_PRESETS['16:9'], { fps: 30 });
    delete p.settings.platform;
  });
}

export function resetTransitionDuration(transitionId: ID) {
  useProjectStore.getState().edit('ops.resetSection', (p) => updateTransition(p, transitionId, { duration: DEFAULT_TRANSITION_DURATION }));
}

export function resetTransitionKind(transitionId: ID) {
  useProjectStore.getState().edit('ops.resetSection', (p) => updateTransition(p, transitionId, { kind: TRANSITION_KINDS[0] }));
}

type SubtitleSection = 'preset' | 'textStyle' | 'layout' | 'animation' | 'language';

const STYLE_KEYS: Record<Exclude<SubtitleSection, 'language'>, (keyof SubtitleStyle)[]> = {
  textStyle: ['fontFamily', 'fontWeight', 'fontSize', 'color', 'strokeColor', 'strokeWidth', 'bgColor', 'bgOpacity'],
  layout: ['position', 'marginY', 'maxWidthPct', 'digits'],
  animation: ['animation', 'highlightColor', 'highlightBg', 'activeScale'],
  preset: [],
};

/** A subtitle track's style section back to the default (Classic) style; 'language' follows the language again. */
export function resetSubtitleSection(trackId: ID, section: SubtitleSection) {
  useProjectStore.getState().edit('ops.resetSection', (p) => {
    const st = p.subtitleTracks.find((x) => x.id === trackId);
    if (!st) return;
    if (section === 'language') {
      st.rtl = RTL_LANGUAGES.includes(st.language);
      return;
    }
    const keys = section === 'preset' ? (Object.keys({ ...DEFAULT_SUBTITLE_STYLE, ...st.style }) as (keyof SubtitleStyle)[]).filter((k) => k !== 'digits') : STYLE_KEYS[section];
    const style = st.style as unknown as Record<string, unknown>;
    const defaults = DEFAULT_SUBTITLE_STYLE as unknown as Record<string, unknown>;
    for (const k of keys) {
      if (defaults[k] === undefined) delete style[k];
      else style[k] = defaults[k];
    }
  });
}
