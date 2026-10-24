// Full-screen preview (the ⛶ button and the ` / ~ key): the preview panel, transport bar included,
// fills the screen; Esc leaves it (the browser's own key).
import { useSyncExternalStore } from 'react';

let target: HTMLElement | null = null;

/** The element that goes full screen (the preview panel registers itself). */
export function setFullscreenTarget(el: HTMLElement | null) {
  target = el;
}

export function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
  else void target?.requestFullscreen().catch(() => {});
}

const subscribe = (cb: () => void) => {
  document.addEventListener('fullscreenchange', cb);
  return () => document.removeEventListener('fullscreenchange', cb);
};

/** True while the preview is full screen. */
export const useFullscreen = () => useSyncExternalStore(subscribe, () => !!target && document.fullscreenElement === target);
