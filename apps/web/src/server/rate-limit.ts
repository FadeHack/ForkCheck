/**
 * Fixed-window counters kept in memory. Enough for one server process; a deployment with
 * several instances would need a shared store.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(
    readonly limit: number,
    readonly windowMs: number,
    private readonly now: () => Date,
  ) {}

  /** Counts one request for `key`; when over the limit, the seconds until the window resets. */
  take(key: string): { ok: true } | { ok: false; retryAfterS: number } {
    const now = this.now().getTime();
    this.prune(now);
    const w = this.windows.get(key);
    if (w === undefined || now - w.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return { ok: true };
    }
    if (w.count >= this.limit) {
      return { ok: false, retryAfterS: Math.ceil((w.start + this.windowMs - now) / 1000) };
    }
    w.count++;
    return { ok: true };
  }

  /** Whether `key` is over the limit, without counting a request. */
  blocked(key: string): { ok: true } | { ok: false; retryAfterS: number } {
    const now = this.now().getTime();
    const w = this.windows.get(key);
    if (w === undefined || now - w.start >= this.windowMs || w.count < this.limit) {
      return { ok: true };
    }
    return { ok: false, retryAfterS: Math.ceil((w.start + this.windowMs - now) / 1000) };
  }

  private prune(now: number): void {
    if (this.windows.size < 10_000) return;
    for (const [key, w] of this.windows) {
      if (now - w.start >= this.windowMs) this.windows.delete(key);
    }
  }
}

export interface RateLimits {
  /** Requests per participant link: the page polls every 5 s, so 120 a minute is ample. */
  participant: RateLimiter;
  /** Failed token lookups per client, so links can't be guessed by brute force. */
  failedAuth: RateLimiter;
}

export function defaultRateLimits(now: () => Date): RateLimits {
  return {
    participant: new RateLimiter(120, 60_000, now),
    failedAuth: new RateLimiter(30, 60_000, now),
  };
}

/** The client address from the proxy headers; local runs without a proxy share one key. */
export function clientKey(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || req.headers.get("x-real-ip") || "local";
}
