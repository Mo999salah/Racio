import { AiError } from '@racio/ai';

/**
 * In-process, bounded per-user rate limiter for the advisor. Suitable for a
 * single web instance; documented as an MVP mechanism (a shared limiter is
 * required before multi-instance deployment). Memory is bounded by pruning
 * expired buckets.
 */
export interface RateLimiter {
  check(userId: string): void;
}

export class InMemoryRateLimiter implements RateLimiter {
  private buckets = new Map<string, { windowStart: number; count: number }>();
  private readonly pruneThreshold = 5_000;

  constructor(
    private readonly windowMs: number,
    private readonly max: number,
  ) {}

  check(userId: string): void {
    const now = Date.now();
    let bucket = this.buckets.get(userId);
    if (!bucket || now - bucket.windowStart >= this.windowMs) {
      bucket = { windowStart: now, count: 0 };
      this.buckets.set(userId, bucket);
    }
    if (bucket.count >= this.max) throw new AiError('AI_RATE_LIMITED');
    bucket.count += 1;
    if (this.buckets.size >= this.pruneThreshold) this.prune(now);
  }

  private prune(now: number) {
    for (const [userId, bucket] of this.buckets) {
      if (now - bucket.windowStart >= this.windowMs) this.buckets.delete(userId);
    }
  }
}
