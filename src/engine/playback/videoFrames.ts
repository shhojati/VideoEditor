// Holds the decoded frame each visible clip shows, and keeps it current:
// - paused: one seek per clip at a time, newest request wins (responsive scrubbing, no backlog);
// - playing: a read-ahead stream per clip; frames the clock has passed are dropped.
import type { VideoSample, VideoSampleSink } from 'mediabunny';
import type { Clip, ID, Project } from '../../model/types';
import { readers } from '../decode/mediaReader';
import { clipVisibleRange } from '../../model/transitions';
import { frameSourceTime, visualClipsAt, type Drawable } from '../render/renderFrame';

const READ_AHEAD = 6;
/** Start decoding clips this long before they become visible during playback (s). */
const PREROLL = 1;

const covers = (s: VideoSample, t: number) => s.timestamp <= t + 1e-4 && t < s.timestamp + s.duration - 1e-4;

class ClipStream {
  private readonly queue: VideoSample[] = [];
  private readonly it: AsyncGenerator<VideoSample, void, unknown>;
  private cancelled = false;
  private wake: (() => void) | null = null;

  constructor(sink: VideoSampleSink, from: number, to: number) {
    this.it = sink.samples(from, to);
    void this.pump();
  }

  private async pump() {
    try {
      while (!this.cancelled) {
        if (this.queue.length >= READ_AHEAD) {
          await new Promise<void>((r) => (this.wake = r));
          continue;
        }
        const next = await this.it.next();
        if (next.done) return;
        if (this.cancelled) {
          next.value.close();
          return;
        }
        this.queue.push(next.value);
      }
    } catch (e) {
      if (!this.cancelled) console.warn('video stream failed', e);
    }
  }

  /** The newest queued frame at or before source time t (ownership passes to the caller). */
  take(t: number): VideoSample | undefined {
    let found: VideoSample | undefined;
    while (this.queue.length && this.queue[0].timestamp <= t + 1e-4) {
      found?.close(); // the clock already passed it: dropped frame
      found = this.queue.shift();
    }
    this.wake?.();
    this.wake = null;
    return found;
  }

  cancel() {
    this.cancelled = true;
    this.wake?.();
    void this.it.return(undefined);
    for (const s of this.queue.splice(0)) s.close();
  }
}

export class VideoFrames {
  private readonly held = new Map<ID, VideoSample>();
  private readonly seeks = new Map<ID, { target?: number; busy: boolean }>();
  private readonly streams = new Map<ID, ClipStream>();
  /** Frames presented during playback vs. the clock, for the A/V sync check. */
  readonly stats = { frames: 0, dropped: 0, maxLag: 0, sumLag: 0, worstAt: -1 };

  constructor(private readonly onFrame: () => void) {}

  /** Synchronous lookup for renderFrame. */
  lookup = (clip: Clip): Drawable | undefined => {
    const asset = clip.assetId ? this.project?.assets[clip.assetId] : undefined;
    if (!asset) return undefined;
    if (asset.kind === 'image') return readers.peek(asset)?.image ?? undefined;
    return this.held.get(clip.id);
  };

  private project: Project | null = null;

  /** Paused: make sure every visible clip gets the exact frame for time t. */
  seek(project: Project, t: number) {
    this.project = project;
    const active = visualClipsAt(project, t).filter(({ clip }) => !clip.text);
    this.releaseExcept(new Set(active.map(({ clip }) => clip.id)));
    for (const { clip } of active) {
      const asset = clip.assetId ? project.assets[clip.assetId] : undefined;
      if (asset?.kind !== 'video') continue;
      const src = frameSourceTime(clip, t, asset.duration);
      const held = this.held.get(clip.id);
      if (held && covers(held, src)) continue;
      const entry = this.seeks.get(clip.id) ?? { busy: false };
      entry.target = src;
      this.seeks.set(clip.id, entry);
      if (!entry.busy) void this.runSeeks(clip.id, asset);
    }
  }

  private async runSeeks(clipId: ID, asset: NonNullable<Project['assets'][string]>) {
    const entry = this.seeks.get(clipId)!;
    entry.busy = true;
    try {
      const reader = await readers.get(asset);
      while (entry.target !== undefined && reader?.video) {
        const t = entry.target;
        entry.target = undefined;
        const sample = await reader.video.getSample(t);
        if (!sample) continue;
        if (this.seeks.get(clipId) !== entry) {
          sample.close(); // clip released meanwhile
          break;
        }
        this.setHeld(clipId, sample);
        this.onFrame();
      }
    } finally {
      entry.busy = false;
    }
  }

  /** Playing: (re)start read-ahead streams from timeline time t. */
  startStreams(project: Project, t: number) {
    this.stopStreams();
    this.project = project;
    this.stats.frames = this.stats.dropped = this.stats.maxLag = this.stats.sumLag = 0;
    this.stats.worstAt = -1;
    this.ensureStreams(t);
  }

  private ensureStreams(t: number) {
    const project = this.project!;
    for (const track of project.tracks) {
      if (track.kind !== 'video') continue;
      for (const clip of track.clips) {
        if (this.streams.has(clip.id)) continue;
        // Transitions make a clip visible before its start and after its end.
        const vis = clipVisibleRange(track, clip);
        if (vis.end <= t || vis.start > t + PREROLL) continue;
        const asset = clip.assetId ? project.assets[clip.assetId] : undefined;
        if (asset?.kind !== 'video') continue;
        const sink = readers.peek(asset)?.video;
        if (!sink) continue; // opens in the background; picked up on a later frame
        const from = frameSourceTime(clip, Math.max(t, vis.start), asset.duration);
        const to = frameSourceTime(clip, vis.end, asset.duration) + 1e-3;
        this.streams.set(clip.id, new ClipStream(sink, from, to));
      }
    }
  }

  /** Playing: advance every visible clip to the frame for clock time t. */
  advance(t: number) {
    const project = this.project!;
    this.ensureStreams(t);
    const active = new Set<ID>();
    for (const { clip } of visualClipsAt(project, t)) {
      active.add(clip.id);
      const stream = this.streams.get(clip.id);
      if (!stream) continue;
      const src = frameSourceTime(clip, t, clip.assetId ? project.assets[clip.assetId]?.duration : undefined);
      const frame = stream.take(src);
      if (frame) this.setHeld(clip.id, frame);
      const held = this.held.get(clip.id);
      if (held) {
        // How far behind the clock the shown frame is (0 when on time).
        const lag = Math.max(0, (src - (held.timestamp + held.duration)) / clip.speed);
        this.stats.frames++;
        if (lag > 0) this.stats.dropped++;
        this.stats.sumLag += lag;
        if (lag > this.stats.maxLag) {
          this.stats.maxLag = lag;
          this.stats.worstAt = t; // timeline time of the worst lag, for diagnosis
        }
      }
    }
    // Finished clips release their stream and frame.
    for (const [id, s] of this.streams) {
      const track = project.tracks.find((tr) => tr.clips.some((c) => c.id === id));
      const ref = track?.clips.find((c) => c.id === id);
      if (!track || !ref || clipVisibleRange(track, ref).end <= t) {
        s.cancel();
        this.streams.delete(id);
      }
    }
    this.releaseExcept(new Set([...active, ...this.streams.keys()]));
  }

  stopStreams() {
    for (const s of this.streams.values()) s.cancel();
    this.streams.clear();
  }

  private setHeld(clipId: ID, sample: VideoSample) {
    const old = this.held.get(clipId);
    if (old && old !== sample) old.close();
    this.held.set(clipId, sample);
  }

  private releaseExcept(keep: ReadonlySet<ID>) {
    for (const [id, s] of this.held)
      if (!keep.has(id)) {
        s.close();
        this.held.delete(id);
      }
    for (const id of this.seeks.keys()) if (!keep.has(id)) this.seeks.delete(id);
  }

  dispose() {
    this.stopStreams();
    this.releaseExcept(new Set());
  }
}
