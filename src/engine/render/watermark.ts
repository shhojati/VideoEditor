// Free-plan watermark, drawn on every exported frame in output pixels (independent of project size).
import type { WatermarkConfig } from '../../lib/appConfig';
import { fontStack } from '../../lib/fonts';

export interface WatermarkSpec {
  config: WatermarkConfig;
  /** Set when the config names an image (loaded by the page, passed to the export worker). */
  image?: ImageBitmap;
}

/** Top-left corner of a w×h box placed per the config, in a width×height frame. */
export function watermarkOrigin(config: WatermarkConfig, w: number, h: number, width: number, height: number) {
  const m = config.margin * Math.min(width, height);
  const [v, hz] = config.position === 'center' ? ['center', 'center'] : config.position.split('-');
  const x = hz === 'left' ? m : hz === 'right' ? width - m - w : (width - w) / 2;
  const y = v === 'top' ? m : v === 'bottom' ? height - m - h : (height - h) / 2;
  return { x, y };
}

type Ctx = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

export function drawWatermark(ctx: Ctx, spec: WatermarkSpec, width: number, height: number) {
  const { config, image } = spec;
  if (!config.enabled || (!image && !config.text.trim())) return;
  const h = Math.max(8, config.size * Math.min(width, height));
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = config.opacity;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  if (config.shadow) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = h * 0.15;
    ctx.shadowOffsetY = h * 0.04;
  }
  if (image) {
    const w = (h * image.width) / Math.max(1, image.height);
    const { x, y } = watermarkOrigin(config, w, h, width, height);
    ctx.drawImage(image, x, y, w, h);
  } else {
    ctx.font = `${config.fontWeight} ${h}px ${fontStack(config.fontFamily)}`;
    ctx.fillStyle = config.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.direction = 'ltr';
    const text = config.text.trim();
    const w = ctx.measureText(text).width;
    const { x, y } = watermarkOrigin(config, w, h, width, height);
    ctx.fillText(text, x, y + h / 2);
  }
  ctx.restore();
}
