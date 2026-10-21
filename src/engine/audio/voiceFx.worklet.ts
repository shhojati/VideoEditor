// AudioWorklet that runs a clip's voice or space chain (engine/audio/voiceDsp.ts) during preview.
// Settings come in once with the node; values over time (keyframes, the tail fade) are computed
// from the context clock, the same way export computes them from the sample position.
import { hasVoiceStage, spaceMixAt, SPACE_TAIL, voiceParamsAt } from '../../model/voiceFx';
import type { Clip } from '../../model/types';
import { CleanChain, hasCleanStage, type NoiseProfile } from './cleanDsp';
import { SpaceChain, VoiceChain } from './voiceDsp';

// AudioWorkletGlobalScope (not in the DOM typings).
declare const sampleRate: number;
declare const currentTime: number;
declare function registerProcessor(name: string, ctor: new (options: { processorOptions: VoiceFxOptions }) => object): void;
declare class AudioWorkletProcessor {}

export interface VoiceFxOptions {
  mode: 'voice' | 'space';
  /** The clip's timing, audio settings and keyframes. */
  clip: Pick<Clip, 'start' | 'duration' | 'inPoint' | 'speed' | 'audio' | 'keyframes'>;
  /** Context time that corresponds to timeline time t0. */
  ctxStart: number;
  t0: number;
  /** Timeline time the clip's audio ends (transitions included). */
  end: number;
  /** The asset's noise profile, for noise reduction (voice mode). */
  noise?: NoiseProfile;
}

class VoiceFxProcessor extends AudioWorkletProcessor {
  private readonly o: VoiceFxOptions;
  private readonly chain?: VoiceChain | SpaceChain;
  private readonly clean?: CleanChain;
  private readonly buf: [Float32Array, Float32Array] = [new Float32Array(128), new Float32Array(128)];

  constructor({ processorOptions: o }: { processorOptions: VoiceFxOptions }) {
    super();
    this.o = o;
    const clip = o.clip as Clip;
    // Voice mode = cleanup (if any) then the voice effect (if any), as in export.
    if (o.mode === 'voice' && hasCleanStage(clip)) this.clean = new CleanChain(clip.audio.clean!, sampleRate, o.noise);
    if (o.mode === 'space') this.chain = new SpaceChain(clip.audio.space!, sampleRate, (t) => spaceMixAt(clip, t, o.end));
    else if (hasVoiceStage(clip)) this.chain = new VoiceChain(clip.audio.voice?.kind, sampleRate, (t) => voiceParamsAt(clip, t));
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]) {
    const t = this.o.t0 + (currentTime - this.o.ctxStart);
    const input = inputs[0];
    const out = outputs[0];
    const n = out[0].length;
    if (this.buf[0].length < n) this.buf.splice(0, 2, new Float32Array(n), new Float32Array(n));
    const [l, r] = this.buf;
    if (input.length) {
      l.set(input[0].subarray(0, n));
      r.set((input[1] ?? input[0]).subarray(0, n));
    } else {
      l.fill(0, 0, n);
      r.fill(0, 0, n);
    }
    this.clean?.process(this.buf, n);
    this.chain?.process(this.buf, n, t);
    out[0].set(l.subarray(0, n));
    out[1]?.set(r.subarray(0, n));
    // The voice stage stops with the clip; the space one rings on for its tail.
    return t < this.o.end + (this.o.mode === 'space' ? SPACE_TAIL : 0.5);
  }
}

registerProcessor('voice-fx', VoiceFxProcessor);
