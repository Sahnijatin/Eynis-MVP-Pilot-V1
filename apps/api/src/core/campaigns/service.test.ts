import test from "node:test";
import assert from "node:assert/strict";
import {
  validateCampaignCreate,
  buildCampaignUpdate,
  validateFollowUpRules,
  validateOutcomeTypes,
  outcomeBreakdown,
  serializeCampaign,
  assistantParamsForVariant,
  provisionCampaignAssistants,
} from "./service";
import type { VapiCredentials, VapiResult, AssistantParams } from "./vapi";

const validBody = {
  name: "Summer Upsell",
  scriptTemplate: "Hi {lead.firstName}",
  voiceA: "Rachel", voiceB: "Aria",
  personaA: "Enthusiastic", personaB: "Sophisticated",
};

// ── Create validation ─────────────────────────────────────────────────────────

test("validateCampaignCreate accepts a valid body and applies defaults", () => {
  const r = validateCampaignCreate(validBody);
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.maxRetries, 2);
    assert.equal(r.value.retryDelayHours, 24);
    assert.equal(r.value.maxConcurrent, 5);
    assert.equal(r.value.defaultCountryCode, "+91");
    assert.deepEqual(r.value.outcomeTypes, []);
    assert.deepEqual(r.value.followUpRules, {});
    assert.equal(r.value.spendCapCalls, null);
  }
});

test("validateCampaignCreate reports all missing required fields", () => {
  const r = validateCampaignCreate({ name: "x" });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /scriptTemplate/);
});

test("validateCampaignCreate rejects a bad spendCapCalls", () => {
  const r = validateCampaignCreate({ ...validBody, spendCapCalls: -3 });
  assert.equal(r.ok, false);
});

// ── follow-up rules + outcomes ────────────────────────────────────────────────

test("validateFollowUpRules keeps only supported channels", () => {
  assert.deepEqual(
    validateFollowUpRules({ interested: ["whatsapp", "email", "carrier_pigeon"] }),
    { interested: ["whatsapp", "email"] },
  );
});

test("validateFollowUpRules rejects non-object / array shapes", () => {
  assert.equal(validateFollowUpRules(["x"]), null);
  assert.equal(validateFollowUpRules({ interested: "whatsapp" }), null);
});

test("validateOutcomeTypes trims and drops non-strings", () => {
  assert.deepEqual(validateOutcomeTypes([" interested ", 5, "not_now"]), ["interested", "not_now"]);
  assert.equal(validateOutcomeTypes("interested"), null);
});

// ── Update builder ────────────────────────────────────────────────────────────

test("buildCampaignUpdate allow-lists fields and serialises JSON", () => {
  const r = buildCampaignUpdate({ name: "New", outcomeTypes: ["a"], maxConcurrent: 8 });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.name, "New");
    assert.equal(r.value.outcomeTypes, JSON.stringify(["a"]));
    assert.equal(r.value.maxConcurrent, 8);
  }
});

test("buildCampaignUpdate ignores status and vapiAssistantId (not allow-listed)", () => {
  const r = buildCampaignUpdate({ name: "X", status: "active", vapiAssistantIdA: "hax" });
  assert.ok(r.ok);
  if (r.ok) {
    assert.ok(!("status" in r.value));
    assert.ok(!("vapiAssistantIdA" in r.value));
  }
});

test("buildCampaignUpdate errors when nothing updatable is provided", () => {
  const r = buildCampaignUpdate({ status: "active" });
  assert.equal(r.ok, false);
});

test("buildCampaignUpdate allows clearing calendlyLink to null", () => {
  const r = buildCampaignUpdate({ calendlyLink: null });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.value.calendlyLink, null);
});

// ── Serialisation + stats ─────────────────────────────────────────────────────

test("serializeCampaign parses JSON fields safely", () => {
  const c = serializeCampaign({ outcomeTypes: '["interested"]', followUpRules: '{"interested":["email"]}', name: "x" } as any);
  assert.deepEqual(c.outcomeTypes, ["interested"]);
  assert.deepEqual(c.followUpRules, { interested: ["email"] });
});

test("serializeCampaign tolerates malformed JSON", () => {
  const c = serializeCampaign({ outcomeTypes: "not json", followUpRules: "{bad" } as any);
  assert.deepEqual(c.outcomeTypes, []);
  assert.deepEqual(c.followUpRules, {});
});

test("outcomeBreakdown maps rows and labels nulls as unknown", () => {
  assert.deepEqual(
    outcomeBreakdown([{ outcome: "interested", count: 3 }, { outcome: null, count: 2 }]),
    { interested: 3, unknown: 2 },
  );
});

// ── Provisioning orchestrator (dependency-injected fake) ─────────────────────

const provisionable = {
  name: "C", scriptTemplate: "Hi", voiceA: "Rachel", voiceB: "Aria",
  personaA: "Enthusiastic", personaB: "Sophisticated", outcomeTypes: ["interested"],
};
const creds: VapiCredentials = { apiKey: "k", phoneNumberId: "p", webhookSecret: "s" };

test("assistantParamsForVariant maps the correct voice + persona per variant", () => {
  const a = assistantParamsForVariant(provisionable, "A", { apiDomain: "api.x", agentName: "Maya", webhookSecret: "s" });
  const b = assistantParamsForVariant(provisionable, "B", { apiDomain: "api.x", agentName: "Maya", webhookSecret: "s" });
  assert.equal(a.elevenLabsVoiceId, "Rachel");
  assert.equal(a.personaLabel, "Enthusiastic");
  assert.equal(b.elevenLabsVoiceId, "Aria");
  assert.equal(b.personaLabel, "Sophisticated");
});

test("provisionCampaignAssistants returns both ids on success", async () => {
  let n = 0;
  const fake = async (): Promise<VapiResult<{ id: string }>> => ({ ok: true, data: { id: `asst_${++n}` } });
  const r = await provisionCampaignAssistants({ campaign: provisionable, creds, apiDomain: "api.x", agentName: "Maya", createAssistant: fake });
  assert.ok(r.ok);
  if (r.ok) { assert.equal(r.vapiAssistantIdA, "asst_1"); assert.equal(r.vapiAssistantIdB, "asst_2"); }
});

test("provisionCampaignAssistants surfaces a variant failure and cleans up the orphan", async () => {
  const fake = async (_c: VapiCredentials, p: AssistantParams): Promise<VapiResult<{ id: string }>> =>
    p.variant === "B" ? { ok: false, error: "boom" } : { ok: true, data: { id: "asst_a" } };
  const deleted: string[] = [];
  const fakeDelete = async (_c: VapiCredentials, id: string): Promise<VapiResult<{ id: string }>> => {
    deleted.push(id);
    return { ok: true, data: { id } };
  };
  const r = await provisionCampaignAssistants({
    campaign: provisionable, creds, apiDomain: "api.x", agentName: "Maya",
    createAssistant: fake, deleteAssistant: fakeDelete,
  });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.error, /Variant B/);
  // variant A was created then cleaned up — no orphan left at Vapi
  assert.deepEqual(deleted, ["asst_a"]);
});

test("validateCampaignCreate accepts optional agentName", () => {
  const r = validateCampaignCreate({ ...validBody, agentName: "Maya" });
  assert.ok(r.ok);
  if (r.ok) assert.equal(r.value.agentName, "Maya");
  const blank = validateCampaignCreate(validBody);
  assert.ok(blank.ok);
  if (blank.ok) assert.equal(blank.value.agentName, null);
});
