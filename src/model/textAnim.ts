// Text clip in/out animations: how a text looks during its first and last moments. Pure; drawn by
// engine/render/text.ts.
import type { TextAnimKind, TextProps } from './types';

export const TEXT_ANIMS: TextAnimKind[] = ['fade', 'slideUp', 'slideDown', 'slideLeft', 'slideRight', 'pop', 'zoom', 'typewriter', 'wordByWord', 'blurIn', 'wipe'];
export const DEFAULT_ANIM_DURATION = 0.6;

export interface TextAnimState {
  alpha: number;
  /** Offset as fractions of the canvas width / height. */
  dx: number;
  dy: number;
  scale: number;
  /** Blur in pixels of a 1080-pixel short side. */
  blur: number;
  /** Fraction of the text shown: by character (typewriter) or by word. */
  chars: number;
  words: number;
  /** Fraction of the text box uncovered, in reading direction. */
  wipe: number;
}

const IDLE: TextAnimState = { alpha: 1, dx: 0, dy: 0, scale: 1, blur: 0, chars: 1, words: 1, wipe: 1 };
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (p: number) => 1 - (1 - p) ** 3;
/** easeOutBack: overshoots a little before settling (pop). */
const back = (p: number) => {
  const c = 1.70158;
  const q = p - 1;
  return 1 + (c + 1) * q ** 3 + c * q ** 2;
};
const SLIDE = 0.12;

/** The look of one animation `kind` at progress p (0 = start of the way in, 1 = fully shown). */
function stateOf(kind: TextAnimKind, p: number): Partial<TextAnimState> {
  const e = easeOut(clamp01(p));
  switch (kind) {
    case 'fade':
      return { alpha: e };
    case 'slideUp':
      return { alpha: e, dy: (1 - e) * SLIDE };
    case 'slideDown':
      return { alpha: e, dy: -(1 - e) * SLIDE };
    case 'slideLeft':
      return { alpha: e, dx: (1 - e) * SLIDE };
    case 'slideRight':
      return { alpha: e, dx: -(1 - e) * SLIDE };
    case 'pop':
      return { alpha: clamp01(p * 3), scale: 0.4 + 0.6 * back(clamp01(p)) };
    case 'zoom':
      return { alpha: e, scale: 1.6 - 0.6 * e };
    case 'typewriter':
      return { chars: clamp01(p) };
    case 'wordByWord':
      return { words: clamp01(p) };
    case 'blurIn':
      return { alpha: e, blur: (1 - e) * 24 };
    case 'wipe':
      return { wipe: e };
  }
}

/** Combined state at `local` seconds into a clip of `duration`, from the in and out animations. */
export function textAnimState(anim: TextProps['anim'], local: number, duration: number): TextAnimState {
  if (!anim || (!anim.in && !anim.out)) return IDLE;
  const d = Math.max(0.05, Math.min(anim.duration ?? DEFAULT_ANIM_DURATION, duration / 2));
  const parts = [anim.in && local < d ? stateOf(anim.in, local / d) : {}, anim.out && duration - local < d ? stateOf(anim.out, (duration - local) / d) : {}];
  const out = { ...IDLE };
  for (const s of parts) {
    out.alpha *= s.alpha ?? 1;
    out.dx += s.dx ?? 0;
    out.dy += s.dy ?? 0;
    out.scale *= s.scale ?? 1;
    out.blur += s.blur ?? 0;
    out.chars = Math.min(out.chars, s.chars ?? 1);
    out.words = Math.min(out.words, s.words ?? 1);
    out.wipe = Math.min(out.wipe, s.wipe ?? 1);
  }
  return out;
}

/** The first `fraction` of the lines' characters (typewriter) or words (word by word). */
export function revealLines(lines: string[], chars: number, words: number): string[] {
  if (chars >= 1 && words >= 1) return lines;
  if (words < 1) {
    const all = lines.map((l) => l.split(' '));
    let left = Math.floor(all.flat().length * words);
    return all.map((ws) => {
      const shown = ws.slice(0, Math.max(0, left));
      left -= ws.length;
      return shown.join(' ');
    });
  }
  // Whole characters (an emoji is one), so nothing is cut in half.
  const split = lines.map((l) => Array.from(l));
  let left = Math.floor(split.flat().length * chars);
  return split.map((cs) => {
    const shown = cs.slice(0, Math.max(0, left)).join('');
    left -= cs.length;
    return shown;
  });
}
