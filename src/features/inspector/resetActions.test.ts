import { beforeEach, describe, expect, it } from 'vitest';
import { createEffect } from '../../model/effects';
import { createProject, createSubtitleTrack, DEFAULT_SUBTITLE_STYLE } from '../../model/factories';
import { defaultShape, TEXT_STYLE_DEFAULTS } from '../../model/overlays';
import { addShapeClip, addTextClip, createClip } from '../../model/timeline';
import type { Asset, Clip, Project } from '../../model/types';
import { useProjectStore } from '../../store/projectStore';
import { resetClipSection, resetClipsToDefault, resetSubtitleSection } from './resetActions';

const video: Asset = { id: 'v', kind: 'video', name: 'v.mp4', duration: 10, hasAudio: true, fileRef: { opfsPath: 'v' } } as Asset;

function setup(): { video: Clip; text: string; shape: string } {
  const p: Project = createProject('t');
  p.assets.v = video;
  const clip = createClip(video, 0);
  p.tracks[1].clips.push(clip);
  const text = addTextClip(p, 0, { ...TEXT_STYLE_DEFAULTS, content: 'سلام', rtl: true });
  const shape = addShapeClip(p, 0, defaultShape('star'));
  p.subtitleTracks.push({ ...createSubtitleTrack('fa'), id: 's' });
  useProjectStore.getState().load(p);
  return { video: clip, text, shape };
}

const clip = (id: string) => useProjectStore.getState().history!.present.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!;
const edit = (id: string, fn: (c: Clip) => void) => useProjectStore.getState().edit('x', (d) => fn(d.tracks.flatMap((t) => t.clips).find((c) => c.id === id)!));

let ids: ReturnType<typeof setup>;
beforeEach(() => void (ids = setup()));

describe('section reset', () => {
  it('puts the transform back and drops its keyframes, keeping other animated values', () => {
    edit(ids.video.id, (c) => {
      Object.assign(c.transform, { x: 0.3, scale: 2, rotation: 45, crop: { x: 0.1, y: 0, width: 0.9, height: 1 } });
      c.keyframes = [
        { t: 0, v: { x: 0.3, volume: 0.5 } },
        { t: 1, v: { scale: 2 } },
      ];
    });
    resetClipSection(ids.video.id, 'transform');
    const c = clip(ids.video.id);
    expect(c.transform).toEqual({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
    expect(c.keyframes).toEqual([{ t: 0, v: { volume: 0.5 } }]);
    // One undo step brings it all back.
    useProjectStore.getState().undo();
    expect(clip(ids.video.id).transform.x).toBe(0.3);
  });

  it('resets audio, voice and cleanup separately', () => {
    edit(ids.video.id, (c) => {
      Object.assign(c.audio, { volume: 0.2, fadeIn: 1, gainDb: 3, clean: { denoise: 0.5 }, voice: { kind: 'robot', pitch: 0, amount: 1 } });
    });
    resetClipSection(ids.video.id, 'audio');
    expect(clip(ids.video.id).audio).toMatchObject({ volume: 1, fadeIn: 0, fadeOut: 0, gainDb: 3 });
    resetClipSection(ids.video.id, 'cleanup');
    expect(clip(ids.video.id).audio.clean).toBeUndefined();
    expect(clip(ids.video.id).audio.voice).toBeDefined();
    resetClipSection(ids.video.id, 'voice');
    expect(clip(ids.video.id).audio.voice).toBeUndefined();
  });

  it('gives a sped-up clip its normal speed back', () => {
    edit(ids.video.id, (c) => Object.assign(c, { speed: 2, duration: 5 }));
    resetClipSection(ids.video.id, 'speed');
    expect(clip(ids.video.id)).toMatchObject({ speed: 1, duration: 10 });
  });

  it('keeps the words of a text clip and the kind of a shape', () => {
    edit(ids.text, (c) => Object.assign(c.text!, { fontSize: 20, color: '#ff0000', shadowColor: '#000' }));
    resetClipSection(ids.text, 'text');
    expect(clip(ids.text).text).toEqual({ ...TEXT_STYLE_DEFAULTS, content: 'سلام', rtl: true });
    edit(ids.shape, (c) => Object.assign(c.shape!, { width: 50, fill: '#000000' }));
    resetClipSection(ids.shape, 'shape');
    expect(clip(ids.shape).shape).toEqual(defaultShape('star'));
  });

  it('resets effect settings but keeps the stack', () => {
    edit(ids.video.id, (c) => {
      const e = createEffect('gaussianBlur');
      e.params.blurriness = 80;
      e.enabled = false;
      c.effects = [e];
    });
    resetClipSection(ids.video.id, 'effects');
    const [e] = clip(ids.video.id).effects!;
    expect(e.enabled).toBe(true);
    expect(e.params).toEqual(createEffect('gaussianBlur').params);
  });

  it('resets one part of a subtitle style', () => {
    useProjectStore.getState().edit('x', (d) => Object.assign(d.subtitleTracks[0].style, { fontSize: 99, position: 'top', digits: 'latin' }));
    resetSubtitleSection('s', 'textStyle');
    const style = useProjectStore.getState().history!.present.subtitleTracks[0].style;
    expect(style.fontSize).toBe(DEFAULT_SUBTITLE_STYLE.fontSize);
    expect(style.position).toBe('top');
    resetSubtitleSection('s', 'preset');
    expect(useProjectStore.getState().history!.present.subtitleTracks[0].style).toEqual({ ...DEFAULT_SUBTITLE_STYLE, digits: 'latin' });
  });
});

describe('clip menu reset', () => {
  it('removes everything added to the clips in one undo step, keeping trim and content', () => {
    edit(ids.video.id, (c) => {
      c.effects = [createEffect('gaussianBlur'), createEffect('look', { preset: 'mono' })];
      c.blend = 'screen';
      c.masks = [{ id: 'm' } as unknown as NonNullable<Clip['masks']>[number]];
      c.keyframes = [{ t: 0, v: { x: 0.3, volume: 0.5 } }];
      Object.assign(c.transform, { x: 0.3, scale: 2 });
      Object.assign(c.audio, { volume: 0.2, voice: { kind: 'robot', pitch: 0, amount: 1 } });
    });
    edit(ids.text, (c) => void (c.effects = [createEffect('gaussianBlur')]));
    const before = clip(ids.video.id);
    const steps = useProjectStore.getState().history!.past.length;

    resetClipsToDefault([ids.video.id, ids.text]);
    const c = clip(ids.video.id);
    expect(c.effects).toBeUndefined();
    expect(c.blend).toBeUndefined();
    expect(c.masks).toBeUndefined();
    expect(c.keyframes).toBeUndefined();
    expect(c.transform).toEqual({ x: 0, y: 0, scale: 1, rotation: 0, opacity: 1 });
    expect(c.audio).toEqual({ volume: 1, fadeIn: 0, fadeOut: 0 });
    expect([c.start, c.duration]).toEqual([before.start, before.duration]);
    expect(clip(ids.text).effects).toBeUndefined();
    expect(clip(ids.text).text!.content).toBe('سلام');
    expect(useProjectStore.getState().history!.past.length).toBe(steps + 1);

    useProjectStore.getState().undo();
    expect(clip(ids.video.id).effects).toHaveLength(2);
    expect(clip(ids.video.id).blend).toBe('screen');
  });
});
