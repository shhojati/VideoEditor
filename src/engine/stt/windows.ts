// Split long audio into ≤30 s windows for Whisper, cutting at the quietest moment near each limit
// (so words are not cut in half), and skipping windows that are essentially silent (Whisper tends
// to hallucinate text on silence).

export interface Window {
  start: number;
  end: number;
}

const FRAME_SEC = 0.02;

export interface WindowOptions {
  maxSec?: number;
  /** How far back from the limit to look for a quiet cut point. */
  searchSec?: number;
  /** RMS below which a whole window counts as silence. */
  silenceRms?: number;
}

export function frameRms(pcm: Float32Array, rate: number): Float32Array {
  const size = Math.round(rate * FRAME_SEC);
  const out = new Float32Array(Math.ceil(pcm.length / size));
  for (let f = 0; f < out.length; f++) {
    let s = 0;
    const end = Math.min(pcm.length, (f + 1) * size);
    for (let i = f * size; i < end; i++) s += pcm[i] * pcm[i];
    out[f] = Math.sqrt(s / Math.max(1, end - f * size));
  }
  return out;
}

/** Windows in samples. */
export function planWindows(pcm: Float32Array, rate: number, opts: WindowOptions = {}): Window[] {
  const { maxSec = 28, searchSec = 6, silenceRms = 0.004 } = opts;
  const rms = frameRms(pcm, rate);
  const frame = Math.round(rate * FRAME_SEC);
  const maxFrames = Math.round(maxSec / FRAME_SEC);
  const searchFrames = Math.round(searchSec / FRAME_SEC);
  const windows: Window[] = [];
  let f = 0;
  while (f < rms.length) {
    let cut = rms.length;
    if (rms.length - f > maxFrames) {
      // Quietest frame in [limit - search, limit] (later frames win ties so windows stay long),
      // then the middle of the quiet run around it, so neither window starts or ends on speech.
      const lo = f + maxFrames - searchFrames;
      cut = f + maxFrames;
      for (let k = cut; k >= lo; k--) if (rms[k] < rms[cut]) cut = k;
      const floor = rms[cut] * 1.5 + 1e-6;
      let a = cut;
      let b = cut;
      while (a - 1 >= lo && rms[a - 1] <= floor) a--;
      while (b + 1 <= f + maxFrames && rms[b + 1] <= floor) b++;
      // No quieter spot anywhere in the search range: just cut at the limit.
      cut = a === lo && b === f + maxFrames ? f + maxFrames : Math.round((a + b + 1) / 2);
    }
    let loud = 0;
    for (let k = f; k < cut; k++) loud = Math.max(loud, rms[k]);
    if (loud >= silenceRms) windows.push({ start: f * frame, end: Math.min(pcm.length, cut * frame) });
    f = cut;
  }
  return windows;
}
