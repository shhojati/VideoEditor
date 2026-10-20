export interface Snap {
  time: number;
  /** The snap point that was hit, for drawing the guide line. */
  target?: number;
}

/** Snap a single time to the closest point within `threshold` seconds. */
export function snapTime(time: number, points: readonly number[], threshold: number): Snap {
  let best: number | undefined;
  for (const p of points) if (Math.abs(p - time) <= threshold && (best === undefined || Math.abs(p - time) < Math.abs(best - time))) best = p;
  return best === undefined ? { time } : { time: best, target: best };
}

/** Snap a moving block by whichever of its edges is closest to a point. Returns the new start. */
export function snapBlock(start: number, duration: number, points: readonly number[], threshold: number): Snap {
  const a = snapTime(start, points, threshold);
  const b = snapTime(start + duration, points, threshold);
  const da = a.target === undefined ? Infinity : Math.abs(a.time - start);
  const db = b.target === undefined ? Infinity : Math.abs(b.time - (start + duration));
  if (da === Infinity && db === Infinity) return { time: start };
  return da <= db ? { time: a.time, target: a.target } : { time: b.time - duration, target: b.target };
}
