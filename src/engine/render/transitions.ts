import type { TransitionKind } from '../../model/types';
import type { Ctx2D } from './renderFrame';

/** Ease in-out so motion starts and ends gently. */
export const smooth = (p: number) => p * p * (3 - 2 * p);

/**
 * Blend the outgoing (`drawFrom`) and incoming (`drawTo`) clip at progress p (0 → 1).
 * Each callback draws one clip into the current context state; this function only sets alpha,
 * clipping, translation, scale or blur around the calls.
 */
export function drawTransition(
  ctx: Ctx2D,
  kind: TransitionKind,
  p: number,
  w: number,
  h: number,
  drawFrom: () => void,
  drawTo: () => void,
) {
  const e = smooth(p);
  const layer = (f: () => void, setup: () => void) => {
    ctx.save();
    setup();
    f();
    ctx.restore();
  };
  const scaleAboutCentre = (s: number) => {
    ctx.translate(w / 2, h / 2);
    ctx.scale(s, s);
    ctx.translate(-w / 2, -h / 2);
  };

  switch (kind) {
    case 'crossfade':
      drawFrom();
      layer(drawTo, () => (ctx.globalAlpha *= p));
      return;
    case 'dipBlack':
    case 'dipWhite': {
      // Fade to the colour by the middle, then from it.
      if (p < 0.5) drawFrom();
      else drawTo();
      layer(() => {
        ctx.fillStyle = kind === 'dipBlack' ? '#000' : '#fff';
        ctx.fillRect(0, 0, w, h);
      }, () => (ctx.globalAlpha *= p < 0.5 ? p * 2 : (1 - p) * 2));
      return;
    }
    case 'wipeLeft':
    case 'wipeRight':
    case 'wipeUp':
    case 'wipeDown': {
      // The edge travels in the named direction, revealing the incoming clip behind it.
      drawFrom();
      const rect: Record<typeof kind, [number, number, number, number]> = {
        wipeLeft: [w * (1 - e), 0, w * e, h],
        wipeRight: [0, 0, w * e, h],
        wipeUp: [0, h * (1 - e), w, h * e],
        wipeDown: [0, 0, w, h * e],
      };
      layer(drawTo, () => {
        ctx.beginPath();
        ctx.rect(...rect[kind]);
        ctx.clip();
      });
      return;
    }
    case 'slideLeft':
    case 'slideRight': {
      // The incoming clip slides in over the outgoing one.
      const dir = kind === 'slideLeft' ? 1 : -1;
      drawFrom();
      layer(drawTo, () => ctx.translate(dir * w * (1 - e), 0));
      return;
    }
    case 'pushLeft':
    case 'pushRight': {
      // The incoming clip pushes the outgoing one out of frame.
      const dir = kind === 'pushLeft' ? 1 : -1;
      layer(drawFrom, () => ctx.translate(-dir * w * e, 0));
      layer(drawTo, () => ctx.translate(dir * w * (1 - e), 0));
      return;
    }
    case 'zoomIn':
      // Push into the outgoing picture while the incoming one fades in.
      layer(drawFrom, () => scaleAboutCentre(1 + 0.6 * e));
      layer(drawTo, () => (ctx.globalAlpha *= p));
      return;
    case 'zoomOut':
      // The incoming picture settles from a close-up while fading in.
      drawFrom();
      layer(drawTo, () => {
        ctx.globalAlpha *= p;
        scaleAboutCentre(1.6 - 0.6 * e);
      });
      return;
    case 'blur': {
      // Blur peaks in the middle while the pictures cross-fade.
      const radius = Math.sin(Math.PI * p) * Math.min(w, h) * 0.03;
      const filter = radius > 0.5 ? `blur(${radius.toFixed(1)}px)` : 'none';
      layer(drawFrom, () => (ctx.filter = filter));
      layer(drawTo, () => {
        ctx.filter = filter;
        ctx.globalAlpha *= p;
      });
      return;
    }
  }
}
