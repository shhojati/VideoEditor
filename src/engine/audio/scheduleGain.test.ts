import { describe, expect, it } from 'vitest';
import { createClip } from '../../model/timeline';
import { scheduleGain } from './audioEngine';

function recorder() {
  const calls: [string, number, number][] = [];
  const param = {
    setValueAtTime: (v: number, t: number) => calls.push(['set', +v.toFixed(3), t]),
    linearRampToValueAtTime: (v: number, t: number) => calls.push(['ramp', +v.toFixed(3), t]),
  } as unknown as AudioParam;
  return { calls, param };
}

const clip = (fadeIn: number, fadeOut: number) => {
  const c = createClip({ id: 'a', kind: 'audio', name: '', duration: 10, fileRef: {} }, 10);
  c.audio = { volume: 0.5, fadeIn, fadeOut };
  return c;
};
const toCtx = (t: number) => t + 100; // timeline -> context time

describe('scheduleGain', () => {
  it('plain volume', () => {
    const { calls, param } = recorder();
    scheduleGain(param, clip(0, 0), 10, 20, toCtx);
    expect(calls).toEqual([['set', 0.5, 110]]);
  });

  it('fade in and out from the clip start', () => {
    const { calls, param } = recorder();
    scheduleGain(param, clip(2, 4), 10, 20, toCtx);
    expect(calls).toEqual([
      ['set', 0, 110],
      ['ramp', 0.5, 112],
      ['set', 0.5, 116],
      ['ramp', 0, 120],
    ]);
  });

  it('starting playback in the middle of a fade-in begins at the partial level', () => {
    const { calls, param } = recorder();
    scheduleGain(param, clip(2, 0), 11, 20, toCtx);
    expect(calls).toEqual([
      ['set', 0.25, 111],
      ['ramp', 0.5, 112],
    ]);
  });

  it('starting inside the fade-out ramps from the current level', () => {
    const { calls, param } = recorder();
    scheduleGain(param, clip(0, 4), 18, 20, toCtx);
    expect(calls).toEqual([
      ['set', 0.25, 118],
      ['ramp', 0, 120],
    ]);
  });
});
