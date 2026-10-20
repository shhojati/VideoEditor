// Web Audio playback. Every audible clip decodes its source range progressively (Mediabunny
// AudioBufferSink) and schedules AudioBufferSourceNodes a couple of seconds ahead on the context
// clock, through a per-clip gain (volume + fades) into the master gain. The context's output clock
// is the master clock for the whole player (plan §4.4).
import type { Clip, Project } from '../../model/types';
import { readers } from '../decode/mediaReader';
import { clipGainAt } from '../fade';
import { sourceTimeAt } from '../render/renderFrame';

/** How far ahead of the clock audio is decoded and scheduled (s). */
const SCHEDULE_AHEAD = 2;
/** Delay between pressing play and the first sample, so the first buffers can be scheduled (s). */
export const START_LEAD = 0.12;

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private generation = 0;
  private nodes: AudioScheduledSourceNode[] = [];
  private gains: GainNode[] = [];
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
    }
    return this.ctx;
  }

  setVolume(v: number) {
    if (this.master) this.master.gain.setTargetAtTime(v, this.context.currentTime, 0.015);
  }

  /** Start playing the project from timeline time t0. Returns once the clock is anchored. */
  async start(project: Project, t0: number, volume: number) {
    this.stop();
    const ctx = this.context;
    if (ctx.state !== 'running') await ctx.resume();
    this.master!.gain.value = volume;
    const gen = ++this.generation;
    this.t0 = t0;
    this.ctxStart = ctx.currentTime + START_LEAD;
    for (const track of project.tracks) {
      if (track.muted || track.kind === 'text') continue;
      for (const clip of track.clips) {
        if (clip.start + clip.duration <= t0 || clip.audio.volume <= 0) continue;
        const asset = clip.assetId ? project.assets[clip.assetId] : undefined;
        if (!asset || (asset.kind === 'video' && !asset.hasAudio) || asset.kind === 'image') continue;
        void this.playClip(clip, asset, gen);
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

  private async playClip(clip: Clip, asset: NonNullable<Project['assets'][string]>, gen: number) {
    const ctx = this.ctx!;
    const from = Math.max(this.t0, clip.start);
    const end = clip.start + clip.duration;
    // Wait until the clip is close enough to bother decoding.
    while (gen === this.generation && this.toCtx(from) - ctx.currentTime > SCHEDULE_AHEAD) await sleep(250);
    if (gen !== this.generation) return;
    const reader = await readers.get(asset);
    if (!reader?.audio || gen !== this.generation) return;

    const gain = ctx.createGain();
    gain.connect(this.master!);
    this.gains.push(gain);
    scheduleGain(gain.gain, clip, from, end, (t) => this.toCtx(t));

    const srcFrom = sourceTimeAt(clip, from);
    const srcTo = clip.inPoint + clip.duration * clip.speed;
    try {
      for await (const { buffer, timestamp } of reader.audio.buffers(srcFrom, srcTo)) {
        if (gen !== this.generation) return;
        // Portion of this buffer inside [srcFrom, srcTo), in source seconds.
        const offset = Math.max(0, srcFrom - timestamp);
        const length = Math.min(buffer.duration, srcTo - timestamp) - offset;
        if (length <= 0) continue;
        let when = this.toCtx(clip.start + (timestamp + offset - clip.inPoint) / clip.speed);
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
          node.connect(gain);
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
    for (const g of this.gains.splice(0)) g.disconnect();
  }
}

/** Volume and linear fades as gain automation, starting mid-clip if playback starts there. */
export function scheduleGain(param: AudioParam, clip: Clip, from: number, end: number, toCtx: (t: number) => number) {
  const { fadeIn, fadeOut } = clip.audio;
  param.setValueAtTime(clipGainAt(clip, from), toCtx(from));
  const fadeInEnd = clip.start + fadeIn;
  if (fadeIn > 0 && fadeInEnd > from) param.linearRampToValueAtTime(clipGainAt(clip, fadeInEnd), toCtx(fadeInEnd));
  if (fadeOut > 0) {
    const fadeOutStart = end - fadeOut;
    if (fadeOutStart > from) param.setValueAtTime(clipGainAt(clip, fadeOutStart), toCtx(fadeOutStart));
    param.linearRampToValueAtTime(0, toCtx(end));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
