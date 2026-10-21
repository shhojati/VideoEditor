import { fontStack, resolveWeight } from '../../lib/fonts';
import { convertDigits, cueAt, cueWords } from '../../model/subtitles';
import type { Cue, Project, SubtitleStyle } from '../../model/types';
import type { Ctx2D } from './renderFrame';
import { balanceLines } from './textLayout';

const LINE_HEIGHT = 1.35;
/** How long a word takes to appear (pop, typewriter), seconds. */
const APPEAR = 0.15;

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
    if (track.style.animation && track.style.animation !== 'none') {
      drawAnimatedCue(ctx, cue, track.style, track.rtl, canvasW, canvasH, t);
    } else {
      drawCue(ctx, convertDigits(cue.text, track.style.digits), track.style, track.rtl, canvasW, canvasH);
    }
  }
}

interface Layout {
  size: number;
  lineH: number;
  lines: string[];
  firstY: number;
  cx: number;
  unit: number;
}

function layout(ctx: Ctx2D, text: string, style: SubtitleStyle, rtl: boolean, canvasW: number, canvasH: number): Layout {
  // Style sizes are defined for a 1080-pixel short side.
  const unit = Math.min(canvasW, canvasH) / 1080;
  const size = style.fontSize * unit;
  const lineH = size * LINE_HEIGHT;
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
  return { size, lineH, lines, firstY, cx: canvasW / 2, unit };
}

function roundBox(ctx: Ctx2D, cx: number, cy: number, w: number, l: Layout) {
  const padX = l.size * 0.35;
  const padY = (l.lineH - l.size) / 2 + l.size * 0.08;
  ctx.beginPath();
  ctx.roundRect(cx - w / 2 - padX, cy - l.size / 2 - padY, w + 2 * padX, l.size + 2 * padY, l.size * 0.15);
  ctx.fill();
}

function setStroke(ctx: Ctx2D, style: SubtitleStyle, unit: number) {
  if (!style.strokeColor || !style.strokeWidth) return false;
  ctx.lineJoin = 'round';
  ctx.lineWidth = style.strokeWidth * unit;
  ctx.strokeStyle = style.strokeColor;
  return true;
}

export function drawCue(ctx: Ctx2D, text: string, style: SubtitleStyle, rtl: boolean, canvasW: number, canvasH: number) {
  ctx.save();
  const l = layout(ctx, text, style, rtl, canvasW, canvasH);
  const { lines, firstY, lineH, cx } = l;
  // Per-line boxes (the usual subtitle look; a single block box would leave big empty corners).
  if (style.bgColor) {
    ctx.fillStyle = withAlpha(style.bgColor, style.bgOpacity ?? 0.6);
    lines.forEach((line, i) => roundBox(ctx, cx, firstY + i * lineH, ctx.measureText(line).width, l));
  }
  if (setStroke(ctx, style, l.unit)) lines.forEach((line, i) => ctx.strokeText(line, cx, firstY + i * lineH));
  ctx.fillStyle = style.color;
  lines.forEach((line, i) => ctx.fillText(line, cx, firstY + i * lineH));
  ctx.restore();
}

interface PlacedWord {
  text: string;
  start: number;
  /** Centre of the word. */
  x: number;
  y: number;
  width: number;
}

/**
 * Where each word sits when the whole cue is laid out. Words are measured whole (never letter by
 * letter) so Persian letters keep joining; in RTL lines the first word is on the right.
 */
export function placeWords(
  lines: string[],
  timed: { text: string; start: number }[],
  measure: (s: string) => number,
  rtl: boolean,
  cx: number,
  firstY: number,
  lineH: number,
): PlacedWord[] {
  const out: PlacedWord[] = [];
  let k = 0;
  lines.forEach((line, i) => {
    const words = line.split(' ').filter(Boolean);
    const lineW = measure(line);
    words.forEach((text, j) => {
      const offset = j ? measure(`${words.slice(0, j).join(' ')} `) : 0;
      const width = measure(text);
      const x = rtl ? cx + lineW / 2 - offset - width / 2 : cx - lineW / 2 + offset + width / 2;
      out.push({ text, start: timed[k]?.start ?? Infinity, x, y: firstY + i * lineH, width });
      k++;
    });
  });
  return out;
}

/** 0 → 1 with a small overshoot (easeOutBack), for the pop-in. */
function popCurve(p: number) {
  const c = 1.70158;
  const q = Math.min(1, Math.max(0, p)) - 1;
  return 1 + (c + 1) * q * q * q + c * q * q;
}

/** The word being spoken: the last one that has started (it stays lit through short pauses). */
export function activeWordIndex(words: { start: number }[], t: number) {
  let active = -1;
  words.forEach((w, i) => {
    if (w.start <= t) active = i;
  });
  return active;
}

export function drawAnimatedCue(
  ctx: Ctx2D,
  cue: Cue,
  style: SubtitleStyle,
  rtl: boolean,
  canvasW: number,
  canvasH: number,
  t: number,
) {
  const timed = cueWords(cue).map((w) => ({ ...w, text: convertDigits(w.text, style.digits) }));
  if (!timed.length) return;
  const anim = style.animation ?? 'none';
  const highlight = style.highlightColor ?? '#ffe14d';
  const activeScale = style.activeScale ?? 1;
  const active = activeWordIndex(timed, t);
  ctx.save();

  if (anim === 'single') {
    if (active < 0) {
      ctx.restore();
      return;
    }
    const scaled = { ...style, fontSize: style.fontSize * activeScale };
    const word = timed[active];
    const l = layout(ctx, word.text, scaled, rtl, canvasW, canvasH);
    const s = popCurve((t - word.start) / APPEAR);
    const width = ctx.measureText(word.text).width;
    ctx.translate(l.cx, l.firstY);
    ctx.scale(s, s);
    if (style.bgColor) {
      ctx.fillStyle = withAlpha(style.bgColor, style.bgOpacity ?? 0.6);
      roundBox(ctx, 0, 0, width, l);
    }
    if (setStroke(ctx, style, l.unit)) ctx.strokeText(word.text, 0, 0);
    ctx.fillStyle = style.highlightColor ?? style.color;
    ctx.fillText(word.text, 0, 0);
    ctx.restore();
    return;
  }

  const l = layout(ctx, timed.map((w) => w.text).join(' '), style, rtl, canvasW, canvasH);
  const measure = (s: string) => ctx.measureText(s).width;
  const placed = placeWords(l.lines, timed, measure, rtl, l.cx, l.firstY, l.lineH);
  if (style.bgColor) {
    ctx.fillStyle = withAlpha(style.bgColor, style.bgOpacity ?? 0.6);
    l.lines.forEach((line, i) => roundBox(ctx, l.cx, l.firstY + i * l.lineH, measure(line), l));
  }
  const stroke = setStroke(ctx, style, l.unit);
  placed.forEach((w, i) => {
    const appear = (t - w.start) / APPEAR;
    // Pop and typewriter show only the words already spoken.
    if ((anim === 'pop' || anim === 'typewriter') && appear < 0) return;
    const isActive = i === active;
    let scale = 1;
    let alpha = 1;
    if (anim === 'pop') {
      scale = popCurve(appear) * (isActive ? activeScale : 1);
      alpha = Math.min(1, appear * 2);
    } else if (anim === 'typewriter') {
      alpha = Math.min(1, appear);
    } else if (anim === 'karaoke' && isActive) {
      scale = activeScale;
    }
    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.translate(w.x, w.y);
    ctx.scale(scale, scale);
    if (anim === 'karaoke' && isActive && style.highlightBg) {
      ctx.fillStyle = style.highlightBg;
      roundBox(ctx, 0, 0, w.width, { ...l, size: l.size * 0.85 });
    }
    if (stroke) ctx.strokeText(w.text, 0, 0);
    ctx.fillStyle = isActive && anim !== 'typewriter' ? highlight : style.color;
    ctx.fillText(w.text, 0, 0);
    ctx.restore();
  });
  ctx.restore();
}
