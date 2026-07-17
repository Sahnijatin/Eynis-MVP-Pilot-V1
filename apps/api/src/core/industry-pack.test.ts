import test from "node:test";
import assert from "node:assert/strict";
import { getIntakePack, DEFAULT_INTAKE_PACK, packLookup } from "./industry-pack";
import { keywordClassify, sanitizeClassification } from "./connectors/ingest";

// #159: the intake taxonomy (categories, keyword routing, SLA) is config-driven per
// industry. These tests lock the hospitality-unchanged guarantee AND prove a
// non-hospitality tenant classifies/SLAs purely from config, no core code change.

test("getIntakePack resolves hospitality to the default pack", () => {
  const pack = getIntakePack("hospitality");
  assert.equal(pack, DEFAULT_INTAKE_PACK);
  assert.equal(pack.defaultCategory, "front_desk");
  assert.deepEqual(pack.sla.byPriority, { urgent: 10, high: 20, normal: 45 });
  assert.equal(pack.offerRouting.byCategory.fnb, "fnb_offer");
});

test("getIntakePack falls back to the generic pack for unknown/null industries", () => {
  const unknown = getIntakePack("aerospace");
  const nullish = getIntakePack(null);
  assert.equal(unknown.industry, "generic");
  assert.equal(nullish.industry, "generic");
  assert.equal(unknown.defaultCategory, "general");
});

test("getIntakePack and packLookup ignore prototype-chain keys", () => {
  // Magic keys must fall through to the generic pack / default, not resolve to
  // inherited Object.prototype members.
  assert.equal(getIntakePack("__proto__").industry, "generic");
  assert.equal(getIntakePack("constructor").industry, "generic");

  const map: Record<string, string> = { fnb: "fnb_offer" };
  assert.equal(packLookup(map, "fnb", "dflt"), "fnb_offer");
  assert.equal(packLookup(map, "constructor", "dflt"), "dflt");
  assert.equal(packLookup(map, "toString", "dflt"), "dflt");
  assert.equal(packLookup(map, "missing", "dflt"), "dflt");
});

test("keywordClassify uses the tenant's pack for category, routing and SLA", () => {
  const generic = getIntakePack("manufacturing"); // -> generic pack in #159

  // Generic pack keyword rules route on neutral vocabulary...
  const broken = keywordClassify("the line is broken and not working", generic);
  assert.equal(broken.category, "maintenance");
  assert.equal(broken.routingHint, "maintenance");

  const billing = keywordClassify("please resend the invoice", generic);
  assert.equal(billing.category, "billing");

  // ...and unmatched messages fall to the generic default, not "front_desk".
  const unknown = keywordClassify("hello there", generic);
  assert.equal(unknown.category, "general");

  // SLA windows are the generic pack's, not hospitality's.
  const urgent = keywordClassify("this is urgent", generic);
  assert.equal(urgent.slaMinutes, 15); // generic urgent, vs hospitality's 10
  assert.equal(keywordClassify("hello there", generic).slaMinutes, 60); // generic normal, vs 45
});

test("sanitizeClassification applies the pack's default category and SLA on bad input", () => {
  const generic = getIntakePack("manufacturing");
  const out = sanitizeClassification(
    { category: "", priority: "PANIC", summary: "", sentiment: "x", routingHint: "", slaMinutes: NaN },
    generic,
  );
  assert.equal(out.category, "general"); // generic default, not "front_desk"
  assert.equal(out.slaMinutes, 60); // generic default, not 45
});
