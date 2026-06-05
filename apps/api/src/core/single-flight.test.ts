import test from "node:test";
import assert from "node:assert/strict";
import { singleFlight } from "./single-flight";

// F-3 / F-4: the campaign worker ticks are wrapped in singleFlight so an overrunning
// pass cannot overlap the next one (which would double-send and overshoot caps).
test("singleFlight skips a concurrent invocation while one is running", async () => {
  let running = 0;
  let maxConcurrent = 0;
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });

  const guarded = singleFlight(async () => {
    calls++;
    running++;
    maxConcurrent = Math.max(maxConcurrent, running);
    await gate; // hold the "tick" open
    running--;
  });

  const first = guarded();            // enters, blocks on gate
  await Promise.resolve();            // let the first call start
  await guarded();                    // must be a no-op while first is in flight
  assert.equal(calls, 1, "second invocation must not run the task");

  release();
  await first;
  assert.equal(maxConcurrent, 1, "the task never ran concurrently");
});

test("singleFlight runs again once the previous invocation has finished", async () => {
  let calls = 0;
  const guarded = singleFlight(async () => { calls++; });

  await guarded();
  await guarded();
  assert.equal(calls, 2, "sequential invocations both run");
});

test("singleFlight releases the guard even when the task throws", async () => {
  let calls = 0;
  const guarded = singleFlight(async () => { calls++; throw new Error("boom"); });

  await assert.rejects(guarded());
  await assert.rejects(guarded()); // guard must have been cleared in finally
  assert.equal(calls, 2);
});
