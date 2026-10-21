// Beat detection for music clips: onset strength (spectral flux), tempo (autocorrelation with a
// preference around 120 BPM) and beat positions (dynamic programming, Ellis 2007, which follows
// small tempo drifts). Pure; runs in the media worker.
import { Fft } from './cleanDsp';

export interface BeatGrid {
  bpm: number;
  /** Beat times in source seconds, ascending. */
  times: number[];
}

const FRAME = 1024;
const HOP = 512;
const MIN_BPM = 60;
const MAX_BPM = 200;
/** Flux above this frequency is ignored (hi-hats and noise blur the beat). */
const MAX_HZ = 8000;

/** Onset strength per hop: positive log-magnitude change summed over frequency, local mean removed. */
export function onsetStrength(mono: Float32Array, rate: number): Float32Array {
  const fft = new Fft(FRAME);
  const win = Float64Array.from({ length: FRAME }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME));
  const bins = Math.min(FRAME / 2, Math.round((MAX_HZ * FRAME) / rate));
  const frames = Math.max(0, Math.floor((mono.length - FRAME) / HOP) + 1);
  const flux = new Float32Array(frames);
  const re = new Float64Array(FRAME);
  const im = new Float64Array(FRAME);
  let prev = new Float64Array(bins);
  let cur = new Float64Array(bins);
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < FRAME; i++) {
      re[i] = mono[f * HOP + i] * win[i];
      im[i] = 0;
    }
    fft.transform(re, im);
    let sum = 0;
    for (let b = 1; b < bins; b++) {
      cur[b] = Math.log1p(100 * Math.hypot(re[b], im[b]));
      if (f > 0) sum += Math.max(0, cur[b] - prev[b]);
    }
    flux[f] = sum;
    [prev, cur] = [cur, prev];
  }
  // Remove the local mean (±0.5 s) so loud and quiet passages weigh the same, keep the peaks.
  const half = Math.round((0.5 * rate) / HOP);
  const out = new Float32Array(frames);
  let acc = 0;
  let lo = 0;
  let hi = -1;
  for (let f = 0; f < frames; f++) {
    while (hi < Math.min(frames - 1, f + half)) acc += flux[++hi];
    while (lo < f - half) acc -= flux[lo++];
    out[f] = Math.max(0, flux[f] - acc / (hi - lo + 1));
  }
  return out;
}

/** Beat period in hops from the onset curve's autocorrelation, weighted towards ~120 BPM. */
function tempoPeriod(onset: Float32Array, framesPerSecond: number): number {
  const minLag = Math.floor((60 * framesPerSecond) / MAX_BPM);
  const maxLag = Math.ceil((60 * framesPerSecond) / MIN_BPM);
  const ac = new Float64Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let s = 0;
    for (let i = lag; i < onset.length; i++) s += onset[i] * onset[i - lag];
    ac[lag] = s / (onset.length - lag || 1);
  }
  let best = minLag;
  let bestScore = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const bpm = (60 * framesPerSecond) / lag;
    const prior = Math.exp(-0.5 * Math.log2(bpm / 120) ** 2);
    const score = ac[lag] * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  // Parabolic refinement between the neighbouring lags.
  const [a, b, c] = [ac[best - 1], ac[best], ac[best + 1]];
  const d = a - 2 * b + c;
  return d < 0 ? best + (0.5 * (a - c)) / d : best;
}

/** Beats as hop indices: the path of onset peaks about one period apart with the best total. */
function trackBeats(onset: Float32Array, period: number): number[] {
  const n = onset.length;
  let mean = 0;
  for (const v of onset) mean += v;
  mean /= n || 1;
  let sd = 0;
  for (const v of onset) sd += (v - mean) ** 2;
  sd = Math.sqrt(sd / (n || 1)) || 1;
  const o = Float64Array.from(onset, (v) => v / sd);
  const ALPHA = 400;
  const score = new Float64Array(n);
  const back = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) {
    // Best previous beat: a high score about one period back (penalised by how far off it is).
    let best = 0;
    let arg = -1;
    for (let p = Math.max(0, Math.round(i - 2 * period)); p <= i - Math.round(period / 2); p++) {
      const s = score[p] - ALPHA * Math.log((i - p) / period) ** 2;
      if (s > best) {
        best = s;
        arg = p;
      }
    }
    score[i] = o[i] + best;
    back[i] = arg;
  }
  // End on the best-scoring frame in the last period, then follow the links back.
  let end = n - 1;
  for (let i = Math.max(0, n - Math.round(period)); i < n; i++) if (score[i] > score[end]) end = i;
  const beats: number[] = [];
  for (let i = end; i >= 0; i = back[i]) {
    beats.push(i);
    if (back[i] < 0) break;
  }
  return beats.reverse();
}

/** Tempo and beats of a mono signal; empty for silence or audio shorter than a few seconds. */
export function detectBeats(mono: Float32Array, rate: number): BeatGrid {
  const onset = onsetStrength(mono, rate);
  const fps = rate / HOP;
  if (onset.length < fps * 3 || !onset.some((v) => v > 0)) return { bpm: 0, times: [] };
  const period = tempoPeriod(onset, fps);
  // Frame f compares the window starting at f·HOP with the previous one: the onset is near its centre.
  const times = trackBeats(onset, period).map((f) => Math.round(((f * HOP + FRAME / 2) / rate) * 1000) / 1000);
  return { bpm: Math.round((60 * fps * 10) / period) / 10, times };
}
