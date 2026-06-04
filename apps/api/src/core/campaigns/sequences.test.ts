import test from "node:test";
import assert from "node:assert/strict";
import { validateSequenceSteps, parseExitOn, nextRunFrom } from "./sequences";

test("validateSequenceSteps: assigns order, defaults waitMinutes, validates channel templates", () => {
  const r = validateSequenceSteps([
    { channel: "whatsapp", whatsappContentSid: "HX1" },
    { channel: "email", waitMinutes: 1440, emailSubject: "Hi", emailBody: "Body" },
  ]);
  assert.ok(r.ok);
  if (!r.ok) return;
  assert.equal(r.value.length, 2);
  assert.equal(r.value[0].order, 0);
  assert.equal(r.value[0].waitMinutes, 0);
  assert.equal(r.value[1].order, 1);
  assert.equal(r.value[1].waitMinutes, 1440);
});

test("validateSequenceSteps: rejects empty, bad channel, missing templates", () => {
  assert.equal(validateSequenceSteps([]).ok, false);
  assert.equal(validateSequenceSteps([{ channel: "sms" }]).ok, false);
  assert.equal(validateSequenceSteps([{ channel: "whatsapp" }]).ok, false); // no contentSid
  assert.equal(validateSequenceSteps([{ channel: "email", emailSubject: "x" }]).ok, false); // no body
  assert.equal(validateSequenceSteps([{ channel: "whatsapp", whatsappContentSid: "HX", waitMinutes: -5 }]).ok, false);
});

test("parseExitOn: keeps only known conditions, deduped", () => {
  assert.deepEqual(parseExitOn(["opted_out", "replied", "replied", "junk"]), ["opted_out", "replied"]);
  assert.deepEqual(parseExitOn('["booked"]'), ["booked"]);
  assert.deepEqual(parseExitOn("nope"), []);
});

test("nextRunFrom: adds minutes", () => {
  const now = new Date("2026-06-04T00:00:00Z");
  assert.equal(nextRunFrom(now, 90).toISOString(), "2026-06-04T01:30:00.000Z");
});
