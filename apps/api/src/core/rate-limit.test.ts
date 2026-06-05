import test from "node:test";
import assert from "node:assert/strict";
import { rateLimit, _resetRateLimits } from "./rate-limit";

// F-24: fixed-window limiter that throttles the public /auth/identify lookup.
test("rateLimit allows up to max within the window, then blocks", () => {
  _resetRateLimits();
  const key = "k1";
  for (let i = 0; i < 5; i++) assert.equal(rateLimit(key, 5, 60_000, 1000), true);
  assert.equal(rateLimit(key, 5, 60_000, 1000), false); // 6th in window → blocked
});

test("rateLimit resets after the window elapses", () => {
  _resetRateLimits();
  const key = "k2";
  assert.equal(rateLimit(key, 1, 1000, 0), true);
  assert.equal(rateLimit(key, 1, 1000, 0), false); // blocked within window
  assert.equal(rateLimit(key, 1, 1000, 2000), true); // window passed → allowed again
});

test("rateLimit isolates different keys", () => {
  _resetRateLimits();
  assert.equal(rateLimit("a", 1, 60_000, 0), true);
  assert.equal(rateLimit("b", 1, 60_000, 0), true); // different key, own bucket
  assert.equal(rateLimit("a", 1, 60_000, 0), false);
});
