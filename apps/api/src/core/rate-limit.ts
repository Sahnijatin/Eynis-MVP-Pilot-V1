// Fixed-window rate limiter for public, unauthenticated endpoints (e.g. the
// /auth/identify email lookup, which is otherwise an unthrottled
// email-enumeration oracle — F-24).
//
// The store is pluggable: the default is in-memory (single-process only — fine
// for the current single-instance deployment), and a multi-instance deploy can
// call setRateLimitStore() with a shared-store adapter (Redis) at startup
// without touching any call site. The async signature exists for exactly that
// swap.

export interface RateLimitStore {
  /** Record a hit and return true if the request is within the limit. */
  hit(key: string, max: number, windowMs: number, now: number): boolean | Promise<boolean>;
  /** Clear all buckets (tests/maintenance). */
  reset(): void | Promise<void>;
}

interface Bucket { count: number; resetAt: number }

class MemoryRateLimitStore implements RateLimitStore {
  private buckets = new Map<string, Bucket>();
  private static MAX_KEYS = 50_000; // bound memory: drop the whole map if it grows too large

  hit(key: string, max: number, windowMs: number, now: number): boolean {
    const existing = this.buckets.get(key);
    if (!existing || now > existing.resetAt) {
      if (this.buckets.size > MemoryRateLimitStore.MAX_KEYS) this.buckets.clear();
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (existing.count >= max) return false;
    existing.count += 1;
    return true;
  }

  reset(): void {
    this.buckets.clear();
  }
}

export function createMemoryRateLimitStore(): RateLimitStore {
  return new MemoryRateLimitStore();
}

let store: RateLimitStore = createMemoryRateLimitStore();

export function setRateLimitStore(s: RateLimitStore): void {
  store = s;
}

export async function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): Promise<boolean> {
  return store.hit(key, max, windowMs, now);
}

// Test/maintenance helper.
export async function _resetRateLimits(): Promise<void> {
  await store.reset();
}
