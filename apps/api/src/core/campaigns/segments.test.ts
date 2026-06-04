import test from "node:test";
import assert from "node:assert/strict";
import { parseSegmentRules, buildLeadWhere, normalizeTags } from "./segments";

test("parseSegmentRules: drops junk, trims, dedupes, keeps booleans", () => {
  const r = parseSegmentRules(JSON.stringify({
    status: ["pending", " pending ", "", "called"],
    consent: true, optedOut: false,
    tagsAny: ["vip", "vip", " gold "], tagsNot: ["churned"],
    company: "  Acme ", search: "", junkKey: 123,
  }));
  assert.deepEqual(r.status, ["pending", "called"]);
  assert.equal(r.consent, true);
  assert.equal(r.optedOut, false);
  assert.deepEqual(r.tagsAny, ["vip", "gold"]);
  assert.deepEqual(r.tagsNot, ["churned"]);
  assert.equal(r.company, "Acme");
  assert.equal(r.search, undefined);
  assert.equal((r as Record<string, unknown>).junkKey, undefined);
});

test("parseSegmentRules: bad JSON / non-object → empty rules", () => {
  assert.deepEqual(parseSegmentRules("{not json"), {});
  assert.deepEqual(parseSegmentRules(null), {});
  assert.deepEqual(parseSegmentRules(42), {});
});

test("buildLeadWhere: empty rules match everything ({})", () => {
  assert.deepEqual(buildLeadWhere({}), {});
});

test("buildLeadWhere: compiles each clause into an AND filter", () => {
  const where = buildLeadWhere({
    status: ["pending"], consent: true, tagsAny: ["vip"], tagsAll: ["gold", "india"],
    tagsNot: ["churned"], company: "Acme", search: "sarah",
  });
  const and = (where.AND ?? []) as Record<string, unknown>[];
  // tenant/campaign scope must NOT be baked in
  assert.ok(JSON.stringify(where).indexOf("hotelId") === -1);
  assert.ok(JSON.stringify(where).indexOf("campaignId") === -1);
  assert.deepEqual(and.find((c) => "status" in c)?.status, { in: ["pending"] });
  assert.deepEqual(and.find((c) => "tags" in c && (c.tags as Record<string, unknown>).hasSome)?.tags, { hasSome: ["vip"] });
  assert.deepEqual(and.find((c) => "tags" in c && (c.tags as Record<string, unknown>).hasEvery)?.tags, { hasEvery: ["gold", "india"] });
  assert.ok(and.some((c) => "NOT" in c));
  assert.ok(and.some((c) => "OR" in c)); // search expands to OR
});

test("normalizeTags: trims, dedupes, drops empties", () => {
  assert.deepEqual(normalizeTags(["a", " a ", "", "b"]), ["a", "b"]);
  assert.deepEqual(normalizeTags("nope"), []);
});
