import { describe, expect, it } from 'vitest';
import { mixClip } from '../engine/export/audioMix';
import { createProject } from './factories';
import { keyedClip, readProps } from './keyframes';
import { createClip } from './timeline';
import type { Clip } from './types';
import { parseProject } from './validate';
import { hasVoiceStage, setSpace, setVoice, SPACE_TAIL, spaceMixAt, voiceParamsAt } from './voiceFx';

const audioClip = (over: Partial<Clip> = {}): Clip => ({
  ...createClip({ id: 'a', kind: 'audio', name: '', duration: 100, fileRef: {} }, 0),
  duration: 2,
  ...over,
});

describe('voice presets', () => {
  it('a preset starts from its own pitch and keeps the intensity', () => {
    const c = audioClip();
    setVoice(c, 'chipmunk');
    expect(c.audio.voice).toEqual({ kind: 'chipmunk', pitch: 12, amount: 1 });
    c.audio.voice!.amount = 0.4;
    setVoice(c, 'robot');
    expect(c.audio.voice).toEqual({ kind: 'robot', pitch: 0, amount: 0.4 });
    setVoice(c, undefined);
    expect(c.audio.voice).toBeUndefined();
    setSpace(c, 'echo');
    expect(c.audio.space).toEqual({ kind: 'echo', mix: 0.4, size: 0.4 });
  });

  it('pitch becomes a ratio; keep-pitch cancels the speed', () => {
    const c = audioClip();
    expect(hasVoiceStage(c)).toBe(false);
    setVoice(c, 'chipmunk');
    expect(voiceParamsAt(c, 1).ratio).toBeCloseTo(2);
    const fast = audioClip({ speed: 2, audio: { volume: 1, fadeIn: 0, fadeOut: 0, keepPitch: true } });
    expect(hasVoiceStage(fast)).toBe(true);
    expect(voiceParamsAt(fast, 0.5).ratio).toBeCloseTo(0.5);
  });

  it('keyframed pitch glides between keyframes', () => {
    const c = audioClip();
    setVoice(c, 'deep');
    c.keyframes = [
      { t: 0, ease: 'linear', v: { 'voice.pitch': 0 } },
      { t: 2, v: { 'voice.pitch': -12 } },
    ];
    expect(voiceParamsAt(c, 1).ratio).toBeCloseTo(2 ** -0.5);
    expect(keyedClip(c, 1).audio.voice!.pitch).toBeCloseTo(-6);
    // The stored clip is untouched.
    expect(c.audio.voice!.pitch).toBe(-4);
  });

  it('only clips with an effect expose its keyframe properties', () => {
    const c = audioClip();
    expect(readProps(c)).not.toHaveProperty('voice.pitch');
    setVoice(c, 'robot');
    setSpace(c, 'hall');
    expect(readProps(c)).toMatchObject({ 'voice.pitch': 0, 'voice.amount': 1, 'space.mix': 0.35 });
  });

  it('the space tail fades out at its end', () => {
    const c = audioClip();
    setSpace(c, 'room');
    expect(spaceMixAt(c, 2.5, 2)).toBeCloseTo(0.25);
    expect(spaceMixAt(c, 2 + SPACE_TAIL, 2)).toBe(0);
  });

  it('projects keep their voice effects through save and load', () => {
    const p = createProject('Test');
    const c = audioClip();
    setVoice(c, 'telephone');
    setSpace(c, 'cave');
    c.audio.keepPitch = true;
    p.tracks[1].clips.push(c);
    expect(parseProject(JSON.parse(JSON.stringify(p)))).toEqual(p);
    c.audio.voice!.pitch = 30;
    expect(() => parseProject(JSON.parse(JSON.stringify(p)))).toThrow(/pitch/);
  });
});

describe('mixClip with voice effects', () => {
  const RATE = 8000;
  const tone = (hz: number, seconds: number) => ({
    channels: [Float32Array.from({ length: seconds * RATE }, (_, i) => 0.5 * Math.sin((2 * Math.PI * hz * i) / RATE))],
    rate: RATE,
    start: 0,
  });
  const crossings = (x: Float32Array, from: number, to: number) => {
    let n = 0;
    for (let i = from * RATE + 1; i < to * RATE; i++) if (x[i - 1] < 0 && x[i] >= 0) n++;
    return n / (to - from);
  };

  it('a chipmunk voice doubles the pitch in place, without shifting the clip', () => {
    const c = audioClip({ start: 1 });
    setVoice(c, 'chipmunk');
    const out: [Float32Array, Float32Array] = [new Float32Array(4 * RATE), new Float32Array(4 * RATE)];
    mixClip(out, RATE, c, tone(200, 3));
    expect(out[0].subarray(0, RATE).every((v) => v === 0)).toBe(true);
    expect(crossings(out[0], 1.2, 2.9)).toBeGreaterThan(390);
    expect(crossings(out[0], 1.2, 2.9)).toBeLessThan(410);
    expect(out[0].subarray(3 * RATE + 10).every((v) => v === 0)).toBe(true);
  });

  it('a space effect rings on past the clip', () => {
    const c = audioClip();
    setSpace(c, 'echo');
    const out: [Float32Array, Float32Array] = [new Float32Array(4 * RATE), new Float32Array(4 * RATE)];
    mixClip(out, RATE, c, tone(200, 3));
    const after = out[0].subarray(2 * RATE, 3 * RATE);
    expect(Math.max(...after.map(Math.abs))).toBeGreaterThan(0.01);
  });
});
