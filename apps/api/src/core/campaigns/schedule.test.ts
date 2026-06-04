import test from "node:test";
import assert from "node:assert/strict";
import { isWithinSendWindow, localParts, parseSendDays, asMinuteOfDay } from "./schedule";

// A fixed instant: 2026-06-04T12:30:00Z (Thursday).
// In Asia/Kolkata (+05:30) that's 18:00 local; in America/New_York (-04:00 DST) 08:30.
const T = new Date("2026-06-04T12:30:00Z");
const IST = "Asia/Kolkata";
const NY = "America/New_York";

test("localParts: converts an instant to local weekday + minute-of-day", () => {
  assert.deepEqual(localParts(T, IST), { weekday: 4, minuteOfDay: 18 * 60 });       // Thu 18:00
  assert.deepEqual(localParts(T, NY), { weekday: 4, minuteOfDay: 8 * 60 + 30 });    // Thu 08:30
});

test("no window + no days → always ok", () => {
  assert.deepEqual(isWithinSendWindow(T, { timeZone: IST }), { ok: true });
});

test("scheduledStartAt in the future blocks", () => {
  const future = new Date(T.getTime() + 3600_000);
  assert.deepEqual(isWithinSendWindow(T, { timeZone: IST, scheduledStartAt: future }), { ok: false, reason: "not_started" });
  const past = new Date(T.getTime() - 3600_000);
  assert.equal(isWithinSendWindow(T, { timeZone: IST, scheduledStartAt: past }).ok, true);
});

test("business-hours window 09:00–21:00", () => {
  // IST local is 18:00 → inside
  assert.equal(isWithinSendWindow(T, { timeZone: IST, windowStartMin: 540, windowEndMin: 1260 }).ok, true);
  // NY local is 08:30 → before 09:00 → outside
  assert.deepEqual(isWithinSendWindow(T, { timeZone: NY, windowStartMin: 540, windowEndMin: 1260 }), { ok: false, reason: "outside_window" });
});

test("overnight window 21:00–06:00 wraps midnight", () => {
  // IST 18:00 → not in [21:00,06:00) → outside
  assert.equal(isWithinSendWindow(T, { timeZone: IST, windowStartMin: 1260, windowEndMin: 360 }).ok, false);
  // a 23:00 IST instant → inside
  const late = new Date("2026-06-04T17:30:00Z"); // 23:00 IST
  assert.equal(isWithinSendWindow(late, { timeZone: IST, windowStartMin: 1260, windowEndMin: 360 }).ok, true);
});

test("allowed weekdays gate off-days", () => {
  // T is Thursday (4). Allow only Mon–Fri (1..5) → ok
  assert.equal(isWithinSendWindow(T, { timeZone: IST, days: [1, 2, 3, 4, 5] }).ok, true);
  // Allow only weekends → off_day
  assert.deepEqual(isWithinSendWindow(T, { timeZone: IST, days: [0, 6] }), { ok: false, reason: "off_day" });
});

test("parseSendDays + asMinuteOfDay normalise/validate", () => {
  assert.deepEqual(parseSendDays("[1,2,2,9,-1,5]"), [1, 2, 5]);
  assert.deepEqual(parseSendDays([0, 6]), [0, 6]);
  assert.deepEqual(parseSendDays("nope"), []);
  assert.equal(asMinuteOfDay(540), 540);
  assert.equal(asMinuteOfDay(1440), null);
  assert.equal(asMinuteOfDay(-1), null);
  assert.equal(asMinuteOfDay("540"), null);
});
