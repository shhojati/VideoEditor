import type { Clip } from '../../model/types';
import { fadeAlpha } from '../fade';
import type { Ctx2D } from './renderFrame';

/**
 * Basic text drawing (single style, explicit line breaks). Phase 5 adds wrapping, background box
 * styling and the inspector; the drawing stays here so preview and export match.
 */
export function drawTextClip(ctx: Ctx2D, clip: Clip, t: number, canvasW: number, canvasH: number) {
  const text = clip.text!;
  const alpha = clip.transform.opacity * fadeAlpha(clip, text.fadeIn, text.fadeOut, t);
  if (alpha <= 0 || !text.content) return;
  const size = text.fontSize * clip.transform.scale;
  const lines = text.content.split('\n');
  const lineH = size * 1.35;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(canvasW / 2 + clip.transform.x * canvasW, canvasH / 2 + clip.transform.y * canvasH);
  if (clip.transform.rotation) ctx.rotate((clip.transform.rotation * Math.PI) / 180);
  ctx.direction = text.rtl ? 'rtl' : 'ltr';
  ctx.font = `${text.fontWeight} ${size}px ${text.fontFamily}, Vazirmatn, sans-serif`;
  ctx.textAlign = text.align;
  ctx.textBaseline = 'middle';
  const widths = lines.map((l) => ctx.measureText(l).width);
  const maxW = Math.max(...widths);
  const x = text.align === 'left' ? -maxW / 2 : text.align === 'right' ? maxW / 2 : 0;
  const top = (-(lines.length - 1) * lineH) / 2;
  if (text.bgColor) {
    ctx.fillStyle = text.bgColor;
    const pad = size * 0.3;
    ctx.fillRect(-maxW / 2 - pad, top - lineH / 2 - pad / 2, maxW + 2 * pad, lines.length * lineH + pad);
  }
  lines.forEach((line, i) => {
    const y = top + i * lineH;
    if (text.strokeColor && text.strokeWidth) {
      ctx.lineJoin = 'round';
      ctx.lineWidth = text.strokeWidth * clip.transform.scale;
      ctx.strokeStyle = text.strokeColor;
      ctx.strokeText(line, x, y);
    }
    ctx.fillStyle = text.color;
    ctx.fillText(line, x, y);
  });
  ctx.restore();
}
