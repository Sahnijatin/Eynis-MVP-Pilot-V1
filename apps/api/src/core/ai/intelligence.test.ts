import test from "node:test";
import assert from "node:assert/strict";
import { extractJson, parseStructured, AiResponseError } from "./intelligence";

// F-6: the AI layer had no tests. extractJson is the riskiest pure function here —
// it pulls a JSON object out of a free-text model response. These lock its current
// behaviour (hardening of the failure modes is tracked separately as F-11).
test("extractJson parses a bare JSON object", () => {
  assert.deepEqual(extractJson('{"headline":"All good","operationalScore":8}'), { headline: "All good", operationalScore: 8 });
});

test("extractJson extracts JSON embedded in surrounding prose", () => {
  const res = extractJson('Here is your briefing:\n{"topPriority":"Fix AC in 204"}\nLet me know if you need more.');
  assert.deepEqual(res, { topPriority: "Fix AC in 204" });
});

test("extractJson handles nested objects and arrays", () => {
  const res = extractJson('```json\n{"recommendations":["raise ADR","push upsell"],"meta":{"score":7}}\n```');
  assert.deepEqual(res, { recommendations: ["raise ADR", "push upsell"], meta: { score: 7 } });
});

test("extractJson returns null when no JSON object is present (F-11)", () => {
  assert.equal(extractJson("the model refused to answer"), null);
});

test("extractJson returns null on malformed JSON instead of throwing (F-11)", () => {
  assert.equal(extractJson('{"unterminated": '), null);
});

test("parseStructured returns the object when required keys are present", () => {
  const obj = parseStructured<{ a: number; b: string }>('{"a":1,"b":"x"}', ["a", "b"]);
  assert.deepEqual(obj, { a: 1, b: "x" });
});

test("parseStructured throws AiResponseError on non-object / missing keys (F-11)", () => {
  assert.throws(() => parseStructured<{ a: number }>("not json", ["a"]), AiResponseError);
  assert.throws(() => parseStructured<{ a: number }>("[1,2,3]", ["a"]), AiResponseError);
  assert.throws(() => parseStructured<{ a: number; b: number }>('{"a":1}', ["a", "b"]), AiResponseError);
});
