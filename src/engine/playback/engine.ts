// Ties the transport (UI intent), the audio master clock, the video frame source and renderFrame
// together, and draws into the preview canvas.
import type { Project } from '../../model/types';
import { currentProject, useProjectStore, viewOf } from '../../store/projectStore';
import { flattenForMedia } from '../../model/sequences';
import { useTransport } from '../../store/transport';
import { AudioEngine } from '../audio/audioEngine';
import type { AudioAux } from '../audio/audioAux';
import { readers } from '../decode/mediaReader';
import { ensureFont, isFontReady } from '../../lib/fonts';
import { renderFrame, visualClipsAt } from '../render/renderFrame';
import { VideoFrames } from './videoFrames';

/** Restart playback this long after the last edit made while playing (s). */
const EDIT_RESTART_DELAY_MS = 150;

class PlaybackEngine {
  private canvas: HTMLCanvasElement | null = null;
  private readonly audio = new AudioEngine();
  private readonly video = new VideoFrames(() => this.requestRender());
  private raf = 0;
  private renderQueued = false;
  /** True while the engine itself writes to the transport store (so it does not react to itself). */
  private writing = false;
  private playToken = 0;
  private editTimer: ReturnType<typeof setTimeout> | undefined;
  private view: { k: number; ox: number; oy: number } | undefined;
  private background = '#000';

  readonly stats = { video: this.video.stats, audio: this.audio.stats };
  /** Duck plan and noise profiles for a project (set by the app: they come from the media cache). */
  audioAux: (project: Project) => AudioAux = () => ({});

  /** What the preview shows: the main timeline, or the opened compound clip's sequence. */
  private get project(): Project | undefined {
    return currentProject() ?? undefined;
  }

  init(): () => void {
    readers.onReady = () => this.refreshPaused();
    const offTransport = useTransport.subscribe((s, prev) => {
      if (this.writing) return;
      if (s.volume !== prev.volume) this.audio.setVolume(s.volume);
      if (s.playing !== prev.playing) {
        if (s.playing) void this.startPlaying(s.time);
        else this.stopPlaying();
      } else if (s.time !== prev.time) {
        if (s.playing) void this.startPlaying(s.time); // seek while playing
        else this.refreshPaused();
      }
    });
    const offProject = useProjectStore.subscribe((s, prev) => {
      const next = viewOf(s.history?.present, s.editPath);
      const before = viewOf(prev.history?.present, prev.editPath);
      if (next === before) return;
      if (next?.id !== before?.id) {
        this.writeTransport({ playing: false, time: 0 });
        this.stopPlaying();
        this.video.dispose();
      }
      readers.retain(next ? new Set(Object.keys(next.assets)) : null);
      if (useTransport.getState().playing) {
        clearTimeout(this.editTimer);
        this.editTimer = setTimeout(() => void this.startPlaying(this.audio.now()), EDIT_RESTART_DELAY_MS);
      } else this.refreshPaused();
    });
    this.refreshPaused();
    if (import.meta.env.DEV) (window as unknown as { __playback: unknown }).__playback = this;
    return () => {
      offTransport();
      offProject();
      this.stopPlaying();
      this.video.dispose();
      readers.retain(null);
    };
  }

  /**
   * `view` maps project pixels to canvas backing pixels (zoom/pan); without one the picture fills
   * the canvas. Outside the picture the canvas is filled with `background`.
   */
  attach(canvas: HTMLCanvasElement | null, view?: { k: number; ox: number; oy: number }, background = '#000') {
    this.canvas = canvas;
    this.view = view;
    this.background = background;
    // Draw now: resizing the canvas has just cleared it (playing, the next tick draws).
    if (!useTransport.getState().playing) this.render(useTransport.getState().time);
  }

  private writeTransport(patch: Partial<ReturnType<typeof useTransport.getState>>) {
    this.writing = true;
    try {
      useTransport.setState(patch);
    } finally {
      this.writing = false;
    }
  }

  private async startPlaying(from: number) {
    const project = this.project;
    const { duration, volume } = useTransport.getState();
    if (!project || duration <= 0) {
      this.writeTransport({ playing: false });
      return;
    }
    const token = ++this.playToken;
    cancelAnimationFrame(this.raf);
    const t0 = from >= duration - 1e-3 ? 0 : from;
    this.writeTransport({ time: t0, playing: true });
    // Compound clips play their insides: audio and decoding use the expanded timeline.
    const media = flattenForMedia(project);
    await this.audio.start(media, t0, volume, this.audioAux(project));
    if (token !== this.playToken) return;
    this.video.startStreams(media, t0);
    const tick = () => {
      if (token !== this.playToken) return;
      const { duration: end, loop } = useTransport.getState();
      const t = this.audio.now();
      if (t >= end) {
        if (loop) {
          void this.startPlaying(0);
          return;
        }
        this.writeTransport({ time: end, playing: false });
        this.stopPlaying();
        return;
      }
      this.writeTransport({ time: t });
      this.video.advance(t);
      this.render(t);
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopPlaying() {
    this.playToken++;
    cancelAnimationFrame(this.raf);
    clearTimeout(this.editTimer);
    this.audio.stop();
    this.video.stopStreams();
    this.refreshPaused();
  }

  /** Paused: fetch exact frames for the playhead and redraw (now with what is held, again as frames arrive). */
  private refreshPaused() {
    const project = this.project;
    if (!project || useTransport.getState().playing) return;
    this.video.seek(flattenForMedia(project), useTransport.getState().time);
    this.requestRender();
  }

  private requestRender() {
    if (this.renderQueued || useTransport.getState().playing) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render(useTransport.getState().time);
    });
  }

  private render(t: number) {
    const project = this.project;
    const canvas = this.canvas;
    if (!project || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    // Fonts load on first use; draw now with the fallback and again once the real font is in.
    const fonts = [
      ...visualClipsAt(flattenForMedia(project), t).flatMap(({ clip }) => (clip.text ? [[clip.text.fontFamily, clip.text.fontWeight] as const] : [])),
      ...project.subtitleTracks.map((st) => [st.style.fontFamily, st.style.fontWeight ?? 600] as const),
    ];
    for (const [family, weight] of fonts) {
      if (isFontReady(family, weight)) continue;
      ensureFont(family, weight).then(
        () => this.requestRender(),
        (e) => console.warn('font failed to load', family, e),
      );
    }
    const { width, height } = project.settings;
    const v = this.view;
    if (!v) {
      ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
      renderFrame(project, t, ctx, this.video.lookup);
      return;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(v.k, 0, 0, v.k, v.ox, v.oy);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();
    renderFrame(project, t, ctx, this.video.lookup);
    ctx.restore();
  }
}

export const playbackEngine = new PlaybackEngine();

// The engine is a stateful singleton (AudioContext, open decoders); hot-swapping it would leave the
// UI attached to the old instance, so editing this module reloads the page in development.
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
