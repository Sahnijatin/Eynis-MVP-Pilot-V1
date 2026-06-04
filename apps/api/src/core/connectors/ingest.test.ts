import test from "node:test";
import assert from "node:assert/strict";
import { keywordClassify } from "./ingest";

// F-6: the keyword classifier is the fallback used whenever no AI key is configured
// (the default in dev/test and any keyless deployment), yet it had no coverage.
test("keywordClassify routes housekeeping requests", () => {
  const c = keywordClassify("Can I get fresh towels please");
  assert.equal(c.category, "housekeeping");
});

test("keywordClassify routes maintenance requests", () => {
  assert.equal(keywordClassify("the AC is broken in my room").category, "maintenance");
});

test("keywordClassify routes f&b requests", () => {
  assert.equal(keywordClassify("I'd like to order room service").category, "fnb");
});

test("keywordClassify routes billing to front_desk and defaults unknown to front_desk", () => {
  assert.equal(keywordClassify("can I see my bill").category, "front_desk");
  assert.equal(keywordClassify("hello there").category, "front_desk");
});

test("keywordClassify escalates priority + tightens SLA on urgent wording", () => {
  const urgent = keywordClassify("this is a medical emergency");
  assert.equal(urgent.priority, "urgent");
  assert.equal(urgent.slaMinutes, 10);

  const high = keywordClassify("please send someone asap");
  assert.equal(high.priority, "high");
  assert.equal(high.slaMinutes, 20);

  const normal = keywordClassify("could I get a recommendation for dinner");
  assert.equal(normal.priority, "normal");
  assert.equal(normal.slaMinutes, 45);
});

test("keywordClassify truncates long summaries to 80 chars", () => {
  const long = "x".repeat(200);
  assert.ok(keywordClassify(long).summary.length <= 80);
});
