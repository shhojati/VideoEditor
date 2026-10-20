import { create } from 'zustand';

interface TransportState {
  /** Playhead position (s). Written by the playback engine while playing. */
  time: number;
  playing: boolean;
  /** Timeline end (s); set by the timeline. */
  duration: number;
  loop: boolean;
  /** Master volume 0..1. */
  volume: number;
  seek: (t: number) => void;
  play: () => void;
  pause: () => void;
  toggle: () => void;
}

/**
 * Player intent and position. UI code only flips these flags; engine/playback reacts to the changes
 * (starts audio, streams frames) and writes `time` from the audio clock while playing.
 */
export const useTransport = create<TransportState>()((set, get) => ({
  time: 0,
  playing: false,
  duration: 0,
  loop: false,
  volume: 1,
  seek: (t) => set({ time: Math.max(0, t) }),
  play: () => get().duration > 0 && set({ playing: true }),
  pause: () => set({ playing: false }),
  toggle: () => (get().playing ? get().pause() : get().play()),
}));
