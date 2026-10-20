import { describe, expect, it } from 'vitest';
import { createClip } from '../../model/timeline';
import { mixClip } from './audioMix';
import { frameCount, outputSize, videoBitrate } from './settings';

describe('export settings', () => {
  it('keeps the aspect ratio with the short side at the resolution, even sizes', () => {
    expect(outputSize({ width: 1920, height: 1080 }, 720)).toEqual({ width: 1280, height: 720 });
    expect(outputSize({ width: 1080, height: 1920 }, 1080)).toEqual({ width: 1080, height: 1920 });
    expect(outputSize({ width: 1080, height: 1350 }, 720)).toEqual({ width: 720, height: 900 });
    expect(outputSize({ width: 1001, height: 999 }, 720)).toEqual({ width: 722, height: 720 });
  });

  it('bitrate scales with pixels and fps; 1080p30 medium ≈ 7.5 Mbps', () => {
    expect(videoBitrate(1920, 1080, 30, 'medium') / 1e6).toBeCloseTo(7.46, 1);
    expect(videoBitrate(1280, 720, 30, 'high')).toBeLessThan(videoBitrate(1920, 1080, 30, 'high'));
  });

  it('frame count covers the whole duration', () => {
    expect(frameCount(2, 30)).toBe(60);
    expect(frameCount(2.01, 30)).toBe(61);
    expect(frameCount(0, 30)).toBe(1);
  });
});

describe('mixClip', () => {
  const clipAt = (start: number, duration: number, over: object = {}) => ({
    ...createClip({ id: 'a', kind: 'audio', name: '', duration: 100, fileRef: {} }, start),
    duration,
    ...over,
  });

  it('places mono source at the clip position on both channels, with volume', () => {
    const out: [Float32Array, Float32Array] = [new Float32Array(10), new Float32Array(10)];
    const clip = clipAt(0.2, 0.3, { audio: { volume: 0.5, fadeIn: 0, fadeOut: 0 } });
    mixClip(out, 10, clip, { channels: [Float32Array.of(1, 1, 1, 1)], rate: 10, start: 0 });
    expect(Array.from(out[0])).toEqual([0, 0, 0.5, 0.5, 0.5, 0, 0, 0, 0, 0]);
    expect(out[1]).toEqual(out[0]);
  });

  it('follows in-point and speed, interpolating between source samples', () => {
    const out: [Float32Array, Float32Array] = [new Float32Array(4), new Float32Array(4)];
    // Source ramp 0,1,2,...; in-point 1 s; 2x speed: output t=0,1,2,3 -> source 1,3,5,7 (rate 1).
    const ramp = Float32Array.from({ length: 10 }, (_, i) => i);
    mixClip(out, 1, clipAt(0, 4, { inPoint: 1, speed: 2 }), { channels: [ramp, ramp], rate: 1, start: 0 });
    expect(Array.from(out[0])).toEqual([1, 3, 5, 7]);
    // Half-rate source -> interpolated values.
    const out2: [Float32Array, Float32Array] = [new Float32Array(4), new Float32Array(4)];
    mixClip(out2, 2, clipAt(0, 2), { channels: [Float32Array.of(0, 2, 4)], rate: 1, start: 0 });
    expect(Array.from(out2[0])).toEqual([0, 1, 2, 3]);
  });

  it('applies fades and sums overlapping clips', () => {
    const out: [Float32Array, Float32Array] = [new Float32Array(4), new Float32Array(4)];
    const ones = { channels: [new Float32Array(10).fill(1)], rate: 1, start: 0 };
    mixClip(out, 1, clipAt(0, 4, { audio: { volume: 1, fadeIn: 2, fadeOut: 0 } }), ones);
    mixClip(out, 1, clipAt(2, 2), ones);
    expect(Array.from(out[0])).toEqual([0, 0.5, 2, 2]);
  });
});
