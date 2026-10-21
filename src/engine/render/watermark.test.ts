import { describe, expect, it } from 'vitest';
import { parsePricing, parseWatermark, watermarkImageUrl } from '../../lib/appConfig';
import { watermarkOrigin } from './watermark';

describe('watermark config', () => {
  it('fills defaults and replaces bad values one by one', () => {
    const wm = parseWatermark({ text: 'my.site', opacity: 7, position: 'middle', size: 0.1 });
    expect(wm.text).toBe('my.site');
    expect(wm.size).toBe(0.1);
    expect(wm.opacity).toBe(0.7); // out of range → default
    expect(wm.position).toBe('bottom-right'); // unknown → default
    expect(wm.enabled).toBe(true);
    expect(parseWatermark(null)).toEqual(parseWatermark({}));
  });

  it('resolves the image path under /config/', () => {
    expect(watermarkImageUrl(parseWatermark({}))).toBeNull();
    expect(watermarkImageUrl(parseWatermark({ image: 'logo.png' }))).toBe('/config/logo.png');
    expect(watermarkImageUrl(parseWatermark({ image: '/brand/logo.png' }))).toBe('/brand/logo.png');
  });

  it('pricing defaults', () => {
    expect(parsePricing({ passes: 'x' })).toEqual({ telegram: '', freeMaxSeconds: 60, passes: [] });
    expect(parsePricing({ freeMaxSeconds: 90 }).freeMaxSeconds).toBe(90);
  });
});

describe('watermarkOrigin', () => {
  const cfg = (position: string) => parseWatermark({ position, margin: 0.05 });

  it('places the box in each corner with the margin of the short side', () => {
    // 1920×1080: margin = 54 px.
    expect(watermarkOrigin(cfg('top-left'), 200, 50, 1920, 1080)).toEqual({ x: 54, y: 54 });
    expect(watermarkOrigin(cfg('bottom-right'), 200, 50, 1920, 1080)).toEqual({ x: 1666, y: 976 });
    expect(watermarkOrigin(cfg('center'), 200, 50, 1920, 1080)).toEqual({ x: 860, y: 515 });
  });

  it('uses the short side for vertical and square video too', () => {
    expect(watermarkOrigin(cfg('top-right'), 100, 40, 1080, 1920)).toEqual({ x: 926, y: 54 });
    expect(watermarkOrigin(cfg('bottom-left'), 100, 40, 1080, 1080)).toEqual({ x: 54, y: 986 });
  });
});
