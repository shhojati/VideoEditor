// Speech activity per asset, for auto ducking, from the waveform peaks the timeline already has.
import { activityFromPeaks, duckPlan, type DuckPlan, type Interval } from '../../engine/audio/ducking';
import type { Project } from '../../model/types';
import { useMedia } from './mediaService';

const cache = new WeakMap<Float32Array, Interval[]>();

/** Speech intervals (source seconds) of an asset; undefined until its waveform is ready. */
export function speechActivity(assetId: string): Interval[] | undefined {
  const w = useMedia.getState().assets[assetId]?.waveform;
  if (!w) return undefined;
  let a = cache.get(w.peaks);
  if (!a) {
    a = activityFromPeaks(w.peaks, w.peaksPerSecond);
    cache.set(w.peaks, a);
  }
  return a;
}

export const projectDuckPlan = (project: Project): DuckPlan => duckPlan(project, speechActivity);
