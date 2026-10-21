import { fontStack, resolveWeight } from '../../lib/fonts';
import type { Clip } from '../../model/types';
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
  const alpha = clip.transform.opacity * fadeAlpha(clip, text.fadeIn, text.fadeOut, t);
  if (alpha <= 0 || !text.content.trim()) return;
  const scale = clip.transform.scale;

  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.translate(canvasW / 2 + clip.transform.x * canvasW, canvasH / 2 + clip.transform.y * canvasH);
  if (clip.transform.rotation) ctx.rotate((clip.transform.rotation * Math.PI) / 180);

  const { lines, size, lineH, blockW, padX, padY } = layoutText(ctx, clip, canvasW);
  const top = (-(lines.length - 1) * lineH) / 2;
  const x = text.align === 'left' ? -blockW / 2 : text.align === 'right' ? blockW / 2 : 0;

  if (text.bgColor) {
    ctx.fillStyle = text.bgColor;
    ctx.beginPath();
    ctx.roundRect(-blockW / 2 - padX, top - lineH / 2 - padY, blockW + 2 * padX, lines.length * lineH + 2 * padY, size * 0.25);
    ctx.fill();
  }

  const stroke = text.strokeColor && text.strokeWidth ? text.strokeWidth * scale : 0;
  lines.forEach((line, i) => {
    const y = top + i * lineH;
    // Shadow under everything; only applied once so stroke and fill do not double it.
    if (text.shadowColor && text.shadowBlur !== undefined) {
      ctx.shadowColor = text.shadowColor;
      ctx.shadowBlur = text.shadowBlur * scale;
      ctx.shadowOffsetY = size * 0.05;
    }
    if (stroke) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = stroke;
      ctx.strokeStyle = text.strokeColor!;
      ctx.strokeText(line, x, y);
      ctx.shadowColor = 'transparent';
    }
    ctx.fillStyle = text.color;
    ctx.fillText(line, x, y);
    ctx.shadowColor = 'transparent';
  });
  ctx.restore();
}
