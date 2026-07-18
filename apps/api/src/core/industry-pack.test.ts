import test from "node:test";
import assert from "node:assert/strict";
import { getIntakePack, DEFAULT_INTAKE_PACK, packLookup, getIndustryPack, getIndustryTerms, OPERATIONAL_RULE_DEFS } from "./industry-pack";
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
  const generic = getIntakePack("logistics"); // unknown industry -> generic pack

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

// #165 — the manufacturing pack: downtime/maintenance/quality/safety taxonomy.
test("manufacturing pack classifies plant-floor signal by category and department", () => {
  const mfg = getIntakePack("manufacturing");
  assert.equal(mfg.industry, "manufacturing");
  assert.deepEqual(mfg.categories, ["safety", "downtime", "quality", "maintenance", "general"]);
  assert.equal(mfg.defaultCategory, "maintenance");

  // Safety wording wins over a co-occurring downtime/maintenance keyword (rule order).
  const safety = keywordClassify("gas leak near line 2, machine down", mfg);
  assert.equal(safety.category, "safety");
  assert.equal(safety.routingHint, "safety");

  const downtime = keywordClassify("conveyor stopped, line offline", mfg);
  assert.equal(downtime.category, "downtime");
  assert.equal(downtime.routingHint, "maintenance"); // downtime routes to the maintenance team

  const quality = keywordClassify("batch has a defect, out of spec", mfg);
  assert.equal(quality.category, "quality");
  assert.equal(quality.routingHint, "quality");

  // Unmatched plant signal defaults to maintenance, not the generic "general".
  assert.equal(keywordClassify("please take a look at unit 5", mfg).category, "maintenance");

  // Urgent downtime gets the tight manufacturing SLA (10m), not generic's 15m.
  assert.equal(keywordClassify("URGENT: press line down", mfg).slaMinutes, 10);
});

// #160 — the composed pack unifies vocabulary + intake + automation set per vertical.

test("getIndustryPack composes vocabulary, intake and automation set per industry", () => {
  const hotel = getIndustryPack("hospitality");
  assert.equal(hotel.label, "Hospitality");
  assert.equal(hotel.vocabulary.contactPlural, "guests");
  assert.equal(hotel.intake, DEFAULT_INTAKE_PACK);
  assert.deepEqual(hotel.automations, ["sla_breach_escalate", "sentiment_low_flag", "checkin_welcome", "upsell_followup"]);

  const mfg = getIndustryPack("manufacturing");
  assert.equal(mfg.label, "Manufacturing");
  assert.equal(mfg.vocabulary.contactPlural, "clients");
  assert.equal(mfg.intake.industry, "manufacturing"); // dedicated intake pack (#165)
  assert.equal(mfg.intake.defaultCategory, "maintenance");
  // Switching the pack changes the active automation set with no engine change.
  assert.deepEqual(mfg.automations, ["sla_breach_escalate", "sentiment_low_flag"]);

  // Every declared automation code resolves to a seedable definition.
  for (const code of [...hotel.automations, ...mfg.automations]) {
    assert.ok(OPERATIONAL_RULE_DEFS[code], `missing rule def for ${code}`);
  }
});

test("getIndustryTerms ignores prototype-chain keys and falls back neutrally", () => {
  assert.equal(getIndustryTerms("__proto__").label, "Operations");
  assert.equal(getIndustryTerms(null).contactPlural, "contacts");
  assert.equal(getIndustryTerms("healthcare").contactPlural, "patients");
});

test("sanitizeClassification applies the pack's default category and SLA on bad input", () => {
  const generic = getIntakePack("logistics"); // unknown -> generic pack
  const out = sanitizeClassification(
    { category: "", priority: "PANIC", summary: "", sentiment: "x", routingHint: "", slaMinutes: NaN },
    generic,
  );
  assert.equal(out.category, "general"); // generic default, not "front_desk"
  assert.equal(out.slaMinutes, 60); // generic default, not 45
});
