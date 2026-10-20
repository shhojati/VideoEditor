import { fontStack, resolveWeight } from '../../lib/fonts';
import { convertDigits, cueAt } from '../../model/subtitles';
import type { Project, SubtitleStyle } from '../../model/types';
import type { Ctx2D } from './renderFrame';
import { balanceLines } from './textLayout';

const LINE_HEIGHT = 1.35;

function withAlpha(hex: string, alpha: number) {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Draw the active cue of every visible subtitle track (on top of everything else). */
export function drawSubtitles(ctx: Ctx2D, project: Project, t: number, canvasW: number, canvasH: number) {
  for (const track of project.subtitleTracks) {
    if (track.hidden) continue;
    const cue = cueAt(track, t);
    if (!cue?.text.trim()) continue;
    drawCue(ctx, convertDigits(cue.text, track.style.digits), track.style, track.rtl, canvasW, canvasH);
  }
}

export function drawCue(ctx: Ctx2D, text: string, style: SubtitleStyle, rtl: boolean, canvasW: number, canvasH: number) {
  // Style sizes are defined for a 1080-pixel short side.
  const unit = Math.min(canvasW, canvasH) / 1080;
  const size = style.fontSize * unit;
  const lineH = size * LINE_HEIGHT;
  ctx.save();
  ctx.direction = rtl ? 'rtl' : 'ltr';
  ctx.font = `${resolveWeight(style.fontFamily, style.fontWeight ?? 600)} ${size}px ${fontStack(style.fontFamily)}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  const lines = balanceLines(text, (style.maxWidthPct / 100) * canvasW, (s) => ctx.measureText(s).width);
  const blockH = lines.length * lineH;
  const margin = style.marginY * unit;
  const firstY =
    style.position === 'top'
      ? margin + lineH / 2
      : style.position === 'middle'
        ? canvasH / 2 - blockH / 2 + lineH / 2
        : canvasH - margin - blockH + lineH / 2;
  const cx = canvasW / 2;

  // Per-line boxes (the usual subtitle look; a single block box would leave big empty corners).
  if (style.bgColor) {
    ctx.fillStyle = withAlpha(style.bgColor, style.bgOpacity ?? 0.6);
    const padX = size * 0.35;
    const padY = (lineH - size) / 2 + size * 0.08;
    lines.forEach((line, i) => {
      const w = ctx.measureText(line).width;
      ctx.beginPath();
      ctx.roundRect(cx - w / 2 - padX, firstY + i * lineH - size / 2 - padY, w + 2 * padX, size + 2 * padY, size * 0.15);
      ctx.fill();
    });
  }
  if (style.strokeColor && style.strokeWidth) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = style.strokeWidth * unit;
    ctx.strokeStyle = style.strokeColor;
    lines.forEach((line, i) => ctx.strokeText(line, cx, firstY + i * lineH));
  }
  ctx.fillStyle = style.color;
  lines.forEach((line, i) => ctx.fillText(line, cx, firstY + i * lineH));
  ctx.restore();
}
