// Space is play/pause, but held over the preview it is the hand tool (drag to pan). Over the
// preview, play/pause therefore happens on key release, and only if no pan was made.
import { useTransport } from '../../store/transport';

type Listener = () => void;
const listeners = new Set<Listener>();

export const spaceHand = {
  /** Pointer is over the preview viewport. */
  hover: false,
  /** Space is down and was pressed over the preview. */
  held: false,
  /** A pan happened while Space was held. */
  used: false,
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
  },
};

const notify = () => listeners.forEach((fn) => fn());

/** Space pressed (not in a text field). Returns true when the preview takes it. */
export function spaceDown(e: KeyboardEvent): boolean {
  if (spaceHand.held) return true; // key repeat
  if (!spaceHand.hover || e.repeat) return false;
  spaceHand.held = true;
  spaceHand.used = false;
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', release);
  notify();
  return true;
}

function onKeyUp(e: KeyboardEvent) {
  if (e.code !== 'Space') return;
  const used = spaceHand.used;
  release();
  if (!used) useTransport.getState().toggle();
}

function release() {
  spaceHand.held = false;
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('blur', release);
  notify();
}
