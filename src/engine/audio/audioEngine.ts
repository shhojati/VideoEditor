// Web Audio playback. Every audible clip decodes its source range progressively (Mediabunny
// AudioBufferSink) and schedules AudioBufferSourceNodes a couple of seconds ahead on the context
// clock, through a per-clip gain (volume + fades) into the master gain. Voice effects add a worklet
// before the gain (voice) and/or after it (space). The context's output clock is the master clock
// for the whole player (plan §4.4).
import { peakVolume } from '../../model/keyframes';
import { hasVoiceStage } from '../../model/voiceFx';
import type { Clip, Project } from '../../model/types';
import { readers } from '../decode/mediaReader';
import { audioEnvelope, type AudioEnvelope } from '../fade';
import { voiceLatency } from './voiceDsp';
import workletUrl from './voiceFx.worklet.ts?worker&url';
import type { VoiceFxOptions } from './voiceFx.worklet';
import type { AudioAux } from './audioAux';
import { cleanLatency, hasCleanStage, type NoiseProfile } from './cleanDsp';
import { isLinear, sourceRangeFor, timelineTimeAt } from '../../model/remap';
import { remapAudio } from '../export/audioMix';
import type { AudioBufferSink } from 'mediabunny';

/** How far ahead of the clock audio is decoded and scheduled (s). */
const SCHEDULE_AHEAD = 2;
/** Timeline seconds per chunk when laying out a ramped clip's audio. */
const REMAP_CHUNK = 2;
/** Delay between pressing play and the first sample, so the first buffers can be scheduled (s). */
export const START_LEAD = 0.12;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private generation = 0;
  private nodes: AudioScheduledSourceNode[] = [];
  /** Per-clip gains and effect worklets. */
  private graph: AudioNode[] = [];
  /** Voice effects are available once the worklet module has loaded (false if it failed). */
  private fxReady: Promise<boolean> | null = null;
  /** Context time that corresponds to timeline time t0. */
  private ctxStart = 0;
  private t0 = 0;
  /** Buffers that were decoded after their start time (their head is skipped), for the A/V check. */
  readonly stats = { buffers: 0, lateBuffers: 0, maxLate: 0 };

  get context(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.fxReady = this.ctx.audioWorklet.addModule(workletUrl).then(
        () => true,
        (e) => {
          console.warn('voice effects unavailable', e);
          return false;
        },
      );
    }
    return this.ctx;
  }

  setVolume(v: number) {
    if (this.master) this.master.gain.setTargetAtTime(v, this.context.currentTime, 0.015);
  }

  /** Start playing the project from timeline time t0. Returns once the clock is anchored. */
  async start(project: Project, t0: number, volume: number, aux: AudioAux = {}) {
    this.stop();
    const ctx = this.context;
    if (ctx.state !== 'running') await ctx.resume();
    const fx = await this.fxReady!;
    this.master!.gain.value = volume;
    const gen = ++this.generation;
    this.t0 = t0;
    this.ctxStart = ctx.currentTime + START_LEAD;
    for (const track of project.tracks) {
      if (track.muted || track.kind === 'text') continue;
      for (const clip of track.clips) {
        const env = audioEnvelope(clip, track, (c) => (c.assetId ? project.assets[c.assetId]?.duration : undefined), aux.duck?.[clip.id]);
        if (env.end <= t0 || peakVolume(clip) <= 0 || clip.freeze) continue;
        const asset = clip.assetId ? project.assets[clip.assetId] : undefined;
        if (!asset || (asset.kind === 'video' && !asset.hasAudio) || asset.kind === 'image') continue;
        void this.playClip(clip, env, asset, gen, fx, aux.noise?.[asset.id]);
      }
    }
  }

  /** Timeline time now, as heard: accounts for output latency where the browser reports it. */
  now(): number {
    const ctx = this.ctx;
    if (!ctx) return this.t0;
    const ts = ctx.getOutputTimestamp?.();
    const heard = ts?.contextTime ?? ctx.currentTime - (ctx.outputLatency || 0);
    return this.t0 + Math.max(0, heard - this.ctxStart);
  }

  private toCtx(t: number) {
    return this.ctxStart + (t - this.t0);
  }

  private async playClip(
    clip: Clip,
    env: AudioEnvelope,
    asset: NonNullable<Project['assets'][string]>,
    gen: number,
    fx: boolean,
    noise: NoiseProfile | undefined,
  ) {
    const ctx = this.ctx!;
    // Transitions extend the audible range past the clip's own edges.
    const from = Math.max(this.t0, env.start);
    const end = env.end;
    // Wait until the clip is close enough to bother decoding.
    while (gen === this.generation && this.toCtx(from) - ctx.currentTime > SCHEDULE_AHEAD) await sleep(250);
    if (gen !== this.generation) return;
    const reader = await readers.get(asset);
    if (!reader?.audio || gen !== this.generation) return;

    const gain = ctx.createGain();
    this.graph.push(gain);
    scheduleEnvelope(gain.gain, env, from, end, (t) => this.toCtx(t));
    // source → [cleanup + voice] → gain → [space] → master
    let input: AudioNode = gain;
    let lead = 0;
    if (fx && (hasVoiceStage(clip) || hasCleanStage(clip))) {
      input = this.fxNode('voice', clip, end, noise);
      input.connect(gain);
      // The cleanup and voice stages delay their output; feed them that much early.
      const delay = (hasVoiceStage(clip) ? voiceLatency(ctx.sampleRate) : 0) + (clip.audio.clean ? cleanLatency(clip.audio.clean, noise) : 0);
      lead = delay / ctx.sampleRate;
    }
    if (fx && clip.audio.space) {
      const space = this.fxNode('space', clip, end);
      gain.connect(space);
      space.connect(this.master!);
    } else gain.connect(this.master!);

    if (!isLinear(clip)) {
      await this.playRemapped(clip, reader.audio, from, end, input, lead, gen);
      return;
    }
    // Before the source starts there is nothing to play (silence), so clamp to 0.
    const range = sourceRangeFor(clip, from, end);
    const srcFrom = Math.max(0, range.from);
    const srcTo = range.to;
    try {
      for await (const { buffer, timestamp } of reader.audio.buffers(srcFrom, srcTo)) {
        if (gen !== this.generation) return;
        // Portion of this buffer inside [srcFrom, srcTo), in source seconds.
        const offset = Math.max(0, srcFrom - timestamp);
        const length = Math.min(buffer.duration, srcTo - timestamp) - offset;
        if (length <= 0) continue;
        let when = this.toCtx(timelineTimeAt(clip, timestamp + offset)) - lead;
        let skip = 0;
        this.stats.buffers++;
        if (when < ctx.currentTime) {
          this.stats.lateBuffers++;
          this.stats.maxLate = Math.max(this.stats.maxLate, ctx.currentTime - when);
          skip = (ctx.currentTime - when) * clip.speed; // decoded too late: drop what already passed
          when = ctx.currentTime;
        }
        if (skip < length) {
          const node = ctx.createBufferSource();
          node.buffer = buffer;
          node.playbackRate.value = clip.speed;
          node.connect(input);
          node.start(when, offset + skip, length - skip);
          this.nodes.push(node);
          node.onended = () => {
            const i = this.nodes.indexOf(node);
            if (i >= 0) this.nodes.splice(i, 1);
          };
        }
        while (gen === this.generation && when - ctx.currentTime > SCHEDULE_AHEAD) await sleep(100);
      }
    } catch (e) {
      if (gen === this.generation) console.warn('audio decode failed', asset.name, e);
    }
  }

  /**
   * Ramped clips: decode the source a couple of seconds at a time, lay it out on the
   * timeline with the export's resampler (remapAudio), and play the result at normal rate.
   */
  private async playRemapped(clip: Clip, audio: AudioBufferSink, from: number, end: number, input: AudioNode, lead: number, gen: number) {
    const ctx = this.ctx!;
    try {
      for (let c0 = from; c0 < end - 1e-4 && gen === this.generation; c0 += REMAP_CHUNK) {
        const c1 = Math.min(end, c0 + REMAP_CHUNK);
        while (gen === this.generation && this.toCtx(c0) - ctx.currentTime > SCHEDULE_AHEAD) await sleep(100);
        const { from: s0, to: s1 } = sourceRangeFor(clip, c0, c1);
        const parts: AudioBuffer[] = [];
        let start = 0;
        for await (const { buffer, timestamp } of audio.buffers(Math.max(0, s0 - 0.02), s1 + 0.02)) {
          if (gen !== this.generation) return;
          if (!parts.length) start = timestamp;
          parts.push(buffer);
        }
        if (!parts.length || gen !== this.generation) continue;
        const channels = Array.from({ length: Math.min(2, parts[0].numberOfChannels) }, (_, c) => {
          const out = new Float32Array(parts.reduce((n, b) => n + b.length, 0));
          let o = 0;
          for (const b of parts) {
            out.set(b.getChannelData(Math.min(c, b.numberOfChannels - 1)), o);
            o += b.length;
          }
          return out;
        });
        const [l, r] = remapAudio(clip, { channels, rate: parts[0].sampleRate, start }, c0, c1, ctx.sampleRate);
        if (!l.length) continue;
        const buffer = ctx.createBuffer(2, l.length, ctx.sampleRate);
        buffer.copyToChannel(l, 0);
        buffer.copyToChannel(r, 1);
        let when = this.toCtx(c0) - lead;
        let skip = 0;
        this.stats.buffers++;
        if (when < ctx.currentTime) {
          this.stats.lateBuffers++;
          this.stats.maxLate = Math.max(this.stats.maxLate, ctx.currentTime - when);
          skip = ctx.currentTime - when;
          when = ctx.currentTime;
        }
        if (skip >= buffer.duration) continue;
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.connect(input);
        node.start(when, skip);
        this.nodes.push(node);
        node.onended = () => {
          const i = this.nodes.indexOf(node);
          if (i >= 0) this.nodes.splice(i, 1);
        };
      }
    } catch (e) {
      if (gen === this.generation) console.warn('audio decode failed', e);
    }
  }

  stop() {
    this.generation++;
    for (const n of this.nodes.splice(0)) {
      try {
        n.stop();
      } catch {
        // not started yet
      }
      n.disconnect();
    }
    for (const g of this.graph.splice(0)) g.disconnect();
  }

  private fxNode(mode: VoiceFxOptions['mode'], clip: Clip, end: number, noise?: NoiseProfile) {
    const { start, duration, inPoint, speed, speedCurve, freeze, audio, keyframes } = clip;
    const processorOptions: VoiceFxOptions = { mode, clip: { start, duration, inPoint, speed, speedCurve, freeze, audio, keyframes }, ctxStart: this.ctxStart, t0: this.t0, end, noise };
    const node = new AudioWorkletNode(this.ctx!, 'voice-fx', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      processorOptions,
    });
    this.graph.push(node);
    return node;
  }
}

/**
 * Gain automation for an envelope from timeline time `from` to `end`: a fixed value, plus a value curve
 * over each ramp (fades, transition crossfades). Starting mid-ramp starts mid-curve.
 */
export function scheduleEnvelope(param: AudioParam, env: AudioEnvelope, from: number, end: number, toCtx: (t: number) => number) {
  const ramps = env.ramps.map(([a, b]) => [Math.max(a, from), Math.min(b, end)] as const).filter(([a, b]) => b - a > 1e-3);
  // An event at the very start of a curve would overlap it (Web Audio rejects that).
  if (!ramps.length || ramps[0][0] > from + 1e-3) param.setValueAtTime(env.gainAt(from), toCtx(from));
  for (const [a, b] of ramps) {
    const n = Math.max(2, Math.ceil((b - a) * 60));
    const curve = Float32Array.from({ length: n }, (_, i) => env.gainAt(a + ((b - a) * i) / (n - 1)));
    param.setValueCurveAtTime(curve, toCtx(a), b - a);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
