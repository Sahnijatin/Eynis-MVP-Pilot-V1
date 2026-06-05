// Minimal in-memory fixed-window rate limiter for public, unauthenticated
// endpoints (e.g. the /auth/identify email lookup, which is otherwise an
// unthrottled email-enumeration oracle — F-24). Single-process only; good enough
// for the current single-instance deployment. For multi-instance, back this with
// a shared store (Redis) later.

interface Bucket { count: number; resetAt: number }
const buckets = new Map<string, Bucket>();
const MAX_KEYS = 50_000; // bound memory: drop the whole map if it grows too large

export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): boolean {
  const existing = buckets.get(key);
  if (!existing || now > existing.resetAt) {
    if (buckets.size > MAX_KEYS) buckets.clear();
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= max) return false;
  existing.count += 1;
  return true;
}

// Test/maintenance helper.
export function _resetRateLimits(): void {
  buckets.clear();
}
