import test from "node:test";
import assert from "node:assert/strict";
import { rateLimit, setRateLimitStore, createMemoryRateLimitStore, _resetRateLimits, type RateLimitStore } from "./rate-limit";

// F-24: fixed-window limiter that throttles the public /auth/identify lookup.
test("rateLimit allows up to max within the window, then blocks", async () => {
  await _resetRateLimits();
  const key = "k1";
  for (let i = 0; i < 5; i++) assert.equal(await rateLimit(key, 5, 60_000, 1000), true);
  assert.equal(await rateLimit(key, 5, 60_000, 1000), false); // 6th in window → blocked
});

test("rateLimit resets after the window elapses", async () => {
  await _resetRateLimits();
  const key = "k2";
  assert.equal(await rateLimit(key, 1, 1000, 0), true);
  assert.equal(await rateLimit(key, 1, 1000, 0), false); // blocked within window
  assert.equal(await rateLimit(key, 1, 1000, 2000), true); // window passed → allowed again
});

test("rateLimit isolates different keys", async () => {
  await _resetRateLimits();
  assert.equal(await rateLimit("a", 1, 60_000, 0), true);
  assert.equal(await rateLimit("b", 1, 60_000, 0), true); // different key, own bucket
  assert.equal(await rateLimit("a", 1, 60_000, 0), false);
});

test("a custom store can be plugged in (and the default restored)", async () => {
  const calls: string[] = [];
  const denyAll: RateLimitStore = {
    hit(key) { calls.push(key); return false; },
    reset() { /* no-op */ },
  };
  setRateLimitStore(denyAll);
  try {
    assert.equal(await rateLimit("x", 100, 60_000, 0), false, "custom store decides");
    assert.deepEqual(calls, ["x"]);
  } finally {
    setRateLimitStore(createMemoryRateLimitStore());
  }
});
