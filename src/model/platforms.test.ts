import { describe, expect, it } from 'vitest';
import { createProject } from './factories';
import { maxDurationOf, overLimitBy, PLATFORM_MAX_DURATION } from './platforms';
import { addTextClip } from './timeline';
import { parseProject } from './validate';

const withLength = (seconds: number, platform?: Parameters<typeof createProject>[2]) => {
  const p = createProject('P', '9:16', platform);
  addTextClip(p, 0, {
    content: 'x',
    fontFamily: 'Inter',
    fontSize: 40,
    fontWeight: 400,
    color: '#fff',
    align: 'center',
    rtl: false,
    fadeIn: 0,
    fadeOut: 0,
  });
  p.tracks.find((t) => t.kind === 'text')!.clips[0].duration = seconds;
  return p;
};

describe('platform length limits', () => {
  it('stores the platform on a new project and keeps it through validation', () => {
    const p = createProject('Reel', '9:16', 'instagramReels');
    expect(p.settings).toMatchObject({ width: 1080, height: 1920, platform: 'instagramReels' });
    expect(parseProject(JSON.parse(JSON.stringify(p))).settings.platform).toBe('instagramReels');
  });

  it('has no limit when no platform is set', () => {
    const p = withLength(10_000);
    expect(maxDurationOf(p)).toBeUndefined();
    expect(overLimitBy(p)).toBe(0);
  });

  it('reports how far the timeline runs over the limit', () => {
    const max = PLATFORM_MAX_DURATION.instagramPost;
    expect(overLimitBy(withLength(max, 'instagramPost'))).toBe(0);
    expect(overLimitBy(withLength(max + 5, 'instagramPost'))).toBeCloseTo(5);
  });

  it('offers the landscape 5:4 size', () => {
    expect(createProject('L', '5:4').settings).toMatchObject({ width: 1350, height: 1080 });
  });
});
