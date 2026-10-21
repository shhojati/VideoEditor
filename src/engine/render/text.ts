import { fontStack, resolveWeight } from '../../lib/fonts';
import type { Clip } from '../../model/types';
import { revealLines, textAnimState } from '../../model/textAnim';
import { fadeAlpha } from '../fade';
import type { Ctx2D } from './renderFrame';
import { wrapLines } from './textLayout';

export const DEFAULT_TEXT_MAX_WIDTH = 0.9;
const LINE_HEIGHT = 1.4;

/**
 * Draw a text clip: wrapped lines, optional rounded background box, shadow, stroke and fill.
 * Position/scale/rotation come from the clip transform (anchor = centre of the text block).
 */
type MeasureCtx = Pick<Ctx2D, 'font' | 'direction' | 'textAlign' | 'textBaseline' | 'measureText'>;

/**
 * Sets the clip's font on `ctx` and lays its text out: wrapped lines, line height and the size of
 * the block (`boxW` × `boxH` includes the background padding). Centred on the origin.
 */
export function layoutText(ctx: MeasureCtx, clip: Clip, canvasW: number) {
  const text = clip.text!;
  const size = text.fontSize * clip.transform.scale;
  const lineH = size * LINE_HEIGHT;
  ctx.direction = text.rtl ? 'rtl' : 'ltr';
  ctx.font = `${resolveWeight(text.fontFamily, text.fontWeight)} ${size}px ${fontStack(text.fontFamily)}`;
  ctx.textAlign = text.align;
  ctx.textBaseline = 'middle';
  const lines = wrapLines(text.content, (text.maxWidth ?? DEFAULT_TEXT_MAX_WIDTH) * canvasW, (s) => ctx.measureText(s).width);
  const blockW = Math.max(0, ...lines.map((l) => ctx.measureText(l).width));
  const padX = text.bgColor ? size * 0.4 : 0;
  const padY = text.bgColor ? size * 0.2 : 0;
  return { lines, size, lineH, blockW, padX, padY, boxW: blockW + 2 * padX, boxH: lines.length * lineH + 2 * padY };
}

export function drawTextClip(ctx: Ctx2D, clip: Clip, t: number, canvasW: number, canvasH: number) {
  const text = clip.text!;
  const anim = textAnimState(text.anim, t - clip.start, clip.duration);
  const alpha = clip.transform.opacity * fadeAlpha(clip, text.fadeIn, text.fadeOut, t) * anim.alpha;
  if (alpha <= 0 || !text.content.trim()) return;
  const scale = clip.transform.scale;

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(canvasW / 2 + (clip.transform.x + anim.dx) * canvasW, canvasH / 2 + (clip.transform.y + anim.dy) * canvasH);
  if (clip.transform.rotation) ctx.rotate((clip.transform.rotation * Math.PI) / 180);
  if (anim.scale !== 1) ctx.scale(anim.scale, anim.scale);
  if (anim.blur > 0.1) ctx.filter = `blur(${(anim.blur * Math.min(canvasW, canvasH)) / 1080}px)`;

  const { lines: full, size, lineH, blockW, padX, padY } = layoutText(ctx, clip, canvasW);
  const top = (-(full.length - 1) * lineH) / 2;
  const x = text.align === 'left' ? -blockW / 2 : text.align === 'right' ? blockW / 2 : 0;
  if (anim.wipe < 1) {
    // Uncover the block in reading direction.
    const w = blockW + 2 * padX;
    const x0 = -blockW / 2 - padX;
    ctx.beginPath();
    ctx.rect(text.rtl ? x0 + w * (1 - anim.wipe) : x0, top - lineH - padY, w * anim.wipe, full.length * lineH + lineH + 2 * padY);
    ctx.clip();
  }
  // Typewriter / word by word: part of each line, kept where the whole line starts.
  const lines = revealLines(full, anim.chars, anim.words);
  const startOf = (i: number) => {
    const w = ctx.measureText(full[i]).width;
    const left = text.align === 'left' ? x : text.align === 'right' ? x - w : x - w / 2;
    return text.rtl ? left + w : left;
  };
  const place = (i: number): [number, number] => {
    if (lines[i] === full[i]) return [x, top + i * lineH];
    ctx.textAlign = text.rtl ? 'right' : 'left';
    return [startOf(i), top + i * lineH];
  };

  if (text.bgColor) {
    ctx.fillStyle = text.bgColor;
    ctx.beginPath();
    ctx.roundRect(-blockW / 2 - padX, top - lineH / 2 - padY, blockW + 2 * padX, lines.length * lineH + 2 * padY, size * 0.25);
    ctx.fill();
  }

  const stroke = text.strokeColor && text.strokeWidth ? text.strokeWidth * scale : 0;
  lines.forEach((line, i) => {
    // Shadow under everything; only applied once so stroke and fill do not double it.
    if (text.shadowColor && text.shadowBlur !== undefined) {
      ctx.shadowColor = text.shadowColor;
      ctx.shadowBlur = text.shadowBlur * scale;
      ctx.shadowOffsetY = size * 0.05;
    }
    if (!line) return;
    const [lx, ly] = place(i);
    if (stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = stroke;
      ctx.strokeStyle = text.strokeColor!;
      ctx.strokeText(line, lx, ly);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = text.color;
    ctx.fillText(line, lx, ly);
    ctx.shadowColor = 'transparent';
    ctx.textAlign = text.align;
  });
  ctx.restore();
}
