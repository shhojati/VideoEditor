/** Fixed-window counter per key (client IP), in memory: one API process, restarts reset it. */
export class RateLimiter {
  private readonly hits = new Map<string, { count: number; resetAt: number }>();
  private readonly max: number;
  private readonly windowMs: number;
  private readonly now: () => number;

  constructor(max: number, windowMs: number, now: () => number = Date.now) {
    this.max = max;
    this.windowMs = windowMs;
    this.now = now;
  }

  /** Counts one attempt; false once the key is over the limit for this window. */
  hit(key: string): boolean {
    const t = this.now();
    let h = this.hits.get(key);
    if (!h || h.resetAt <= t) {
      if (this.hits.size > 10_000) this.prune(t);
      h = { count: 0, resetAt: t + this.windowMs };
      this.hits.set(key, h);
    }
    h.count++;
    return h.count <= this.max;
  }

  private prune(t: number) {
    for (const [k, h] of this.hits) if (h.resetAt <= t) this.hits.delete(k);
  }
}
