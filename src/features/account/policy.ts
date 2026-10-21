// Who may export what. The one place the Free/Pro rules live (see also public/config/pricing.json).
import type { Me } from '../../lib/api';

export type ExportPolicy =
  /** Not logged in (or the account API is unreachable). */
  | { kind: 'login' }
  /** Free account, timeline longer than the Free limit. */
  | { kind: 'tooLong'; maxSeconds: number }
  | { kind: 'ok'; watermark: boolean };

export const isPro = (me: Me | null, now = Date.now()) => !!me && me.proUntil != null && me.proUntil > now;

/**
 * `seconds`: length of what is exported (0 for a single frame). Pro is judged from `proUntil`, so a
 * pass that ran out while the page was open counts as Free.
 */
export function exportPolicy(me: Me | null, freeMaxSeconds: number, seconds: number, now = Date.now()): ExportPolicy {
  if (!me) return { kind: 'login' };
  if (isPro(me, now)) return { kind: 'ok', watermark: false };
  // A frame of tolerance: a timeline of exactly 60 s may end a hair later after edits.
  if (seconds > freeMaxSeconds + 0.01) return { kind: 'tooLong', maxSeconds: freeMaxSeconds };
  return { kind: 'ok', watermark: true };
}

/** Whole days left on a Pro pass (rounded up), or 0. */
export const proDaysLeft = (me: Me | null, now = Date.now()) =>
  me?.proUntil && me.proUntil > now ? Math.ceil((me.proUntil - now) / 86_400_000) : 0;

/**
 * AI features (auto reframe, text-based editing, translation) are Pro-only. Free users can open
 * them; the action itself asks to log in or upgrade.
 */
export const aiAccess = (me: Me | null, now = Date.now()): 'login' | 'upgrade' | 'ok' => (!me ? 'login' : isPro(me, now) ? 'ok' : 'upgrade');
