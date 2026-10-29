import { describe, expect, it } from 'vitest';
import type { Me } from '../../lib/api';
import { exportPolicy, isPro, proDaysLeft } from './policy';

const NOW = Date.UTC(2026, 9, 21);
const DAY = 86_400_000;
const user = (proUntil: number | null): Me => ({
  id: 1,
  code: 'U-1001',
  email: 'a@example.com',
  isAdmin: false,
  plan: proUntil && proUntil > NOW ? 'pro' : 'free',
  proUntil,
  credits: 0,
});

describe('exportPolicy', () => {
  it('asks to log in without an account', () => {
    expect(exportPolicy(null, 60, 10, NOW)).toEqual({ kind: 'login' });
  });

  it('Free: up to the limit with a watermark, longer is blocked', () => {
    expect(exportPolicy(user(null), 60, 30, NOW)).toEqual({ kind: 'ok', watermark: true });
    expect(exportPolicy(user(null), 60, 60, NOW)).toEqual({ kind: 'ok', watermark: true });
    expect(exportPolicy(user(null), 60, 61, NOW)).toEqual({ kind: 'tooLong', maxSeconds: 60 });
    // A single frame (length 0) is always allowed.
    expect(exportPolicy(user(null), 60, 0, NOW)).toEqual({ kind: 'ok', watermark: true });
  });

  it('Pro: any length, no watermark', () => {
    expect(exportPolicy(user(NOW + DAY), 60, 600, NOW)).toEqual({ kind: 'ok', watermark: false });
  });

  it('an expired pass counts as Free even if the server said pro earlier', () => {
    const me = { ...user(NOW + DAY), plan: 'pro' as const };
    expect(exportPolicy(me, 60, 600, NOW + 2 * DAY)).toEqual({ kind: 'tooLong', maxSeconds: 60 });
  });
});

describe('Pro days', () => {
  it('rounds up and is 0 when not Pro', () => {
    expect(isPro(user(NOW + 1), NOW)).toBe(true);
    expect(proDaysLeft(user(NOW + 1), NOW)).toBe(1);
    expect(proDaysLeft(user(NOW + 30 * DAY), NOW)).toBe(30);
    expect(proDaysLeft(user(NOW - 1), NOW)).toBe(0);
    expect(proDaysLeft(null, NOW)).toBe(0);
  });
});
