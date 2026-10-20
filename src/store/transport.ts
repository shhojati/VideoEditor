import { create } from 'zustand';

interface TransportState {
  /** Playhead position (s). */
  time: number;
  playing: boolean;
  /** Where playback stops (timeline end); set by the timeline. */
  duration: number;
  seek: (t: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
}

/**
 * Playhead + play state. Phase 3 drives it with a wall-clock rAF loop so the playhead moves;
 * Phase 4 replaces the loop with the audio-master clock of the playback engine.
 */
export const useTransport = create<TransportState>()((set, get) => {
  let raf = 0;
  let last = 0;
  const tick = (now: number) => {
    const { time, duration, playing } = get();
    if (!playing) return;
    const next = time + (now - last) / 1000;
    last = now;
    if (next >= duration) {
      set({ time: duration, playing: false });
      return;
    }
    set({ time: next });
    raf = requestAnimationFrame(tick);
  };
  return {
    time: 0,
    playing: false,
    duration: 0,
    seek: (t) => set({ time: Math.max(0, t) }),
    play: () => {
      if (get().playing || get().duration <= 0) return;
      if (get().time >= get().duration) set({ time: 0 });
      last = performance.now();
      set({ playing: true });
      raf = requestAnimationFrame(tick);
    },
    pause: () => {
      cancelAnimationFrame(raf);
      set({ playing: false });
    },
    toggle: () => (get().playing ? get().pause() : get().play()),
  };
});
