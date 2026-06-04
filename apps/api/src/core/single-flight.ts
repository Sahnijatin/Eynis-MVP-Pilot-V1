// Single-flight guard for worker ticks.
//
// `setInterval(() => void tick(), ms)` is fire-and-forget: if a tick runs longer
// than the interval, the next one starts while the previous is still in flight.
// For the campaign workers that means two passes each select the same fresh leads
// and send twice (F-3 double-send) and each spend the full remaining budget
// (F-4 spend-cap overshoot). Wrapping the tick so that a concurrent invocation is
// skipped while one is already running makes each pass exclusive within a process.

export function singleFlight<A extends unknown[]>(
  task: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  let inFlight = false;
  return async (...args: A): Promise<void> => {
    if (inFlight) return; // a previous invocation is still running — skip this one
    inFlight = true;
    try {
      await task(...args);
    } finally {
      inFlight = false;
    }
  };
}
