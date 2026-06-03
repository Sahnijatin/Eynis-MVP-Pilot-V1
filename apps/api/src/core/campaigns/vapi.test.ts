import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAssistantPayload,
  buildCallPayload,
  verifyWebhook,
  isVapiConfigured,
  createAssistant,
  toVapiTemplate,
  nestVariableValues,
  webhookHostFromPublicUrl,
  VAPI_LLM_MODEL,
  type AssistantParams,
} from "./vapi";

test("toVapiTemplate converts single-brace placeholders and leaves double-brace intact", () => {
  assert.equal(toVapiTemplate("Hi {lead.firstName} from {tenant.name}"), "Hi {{lead.firstName}} from {{tenant.name}}");
  assert.equal(toVapiTemplate("Hi {{customer.name}}"), "Hi {{customer.name}}"); // already double — untouched
});

test("nestVariableValues nests dotted keys into objects", () => {
  assert.deepEqual(
    nestVariableValues({ "lead.firstName": "Sarah", "lead.company": "Acme", "tenant.name": "Riviera" }),
    { lead: { firstName: "Sarah", company: "Acme" }, tenant: { name: "Riviera" } },
  );
});

test("webhookHostFromPublicUrl extracts host from config; rejects empty (#10)", () => {
  assert.equal(webhookHostFromPublicUrl("https://api.eynis.app"), "api.eynis.app");
  assert.equal(webhookHostFromPublicUrl("https://api.eynis.app/ignored/path"), "api.eynis.app");
  assert.equal(webhookHostFromPublicUrl("api.eynis.app:8080"), "api.eynis.app:8080");
  assert.equal(webhookHostFromPublicUrl(null), null);
  assert.equal(webhookHostFromPublicUrl(""), null);
  assert.equal(webhookHostFromPublicUrl("   "), null);
});

const baseAssistant: AssistantParams = {
  campaignName: "Summer Upsell",
  personaLabel: "Enthusiastic",
  variant: "A",
  scriptTemplate: "Hi {lead.firstName}, want to upgrade your room?",
  elevenLabsVoiceId: "rachel-voice-id",
  agentName: "Maya",
  outcomeTypes: ["interested", "not_now"],
  apiDomain: "api.eynis.app",
  webhookSecret: "whsec_123",
};

test("buildAssistantPayload injects the mandatory AI disclosure into the script", () => {
  const payload = buildAssistantPayload(baseAssistant) as any;
  assert.ok(payload.model.systemPrompt.toLowerCase().includes("ai assistant"));
  assert.ok(payload.model.systemPrompt.includes("want to upgrade your room?"));
  assert.equal(payload.model.model, VAPI_LLM_MODEL);
  assert.equal(payload.model.provider, "anthropic");
});

test("buildAssistantPayload converts {x.y} placeholders to Vapi double-brace {{x.y}}", () => {
  const payload = buildAssistantPayload(baseAssistant) as any;
  // single-brace {lead.firstName} in the script becomes {{lead.firstName}}
  assert.ok(payload.model.systemPrompt.includes("{{lead.firstName}}"));
  assert.ok(!/(?<!\{)\{lead\.firstName\}(?!\})/.test(payload.model.systemPrompt));
  // disclosure's {tenant.name} is converted too
  assert.ok(payload.model.systemPrompt.includes("{{tenant.name}}"));
});

test("buildAssistantPayload wires voice, webhook and outcome enum", () => {
  const payload = buildAssistantPayload(baseAssistant) as any;
  assert.equal(payload.voice.provider, "11labs");
  assert.equal(payload.voice.voiceId, "rachel-voice-id");
  assert.equal(payload.serverUrl, "https://api.eynis.app/webhooks/vapi");
  assert.equal(payload.serverUrlSecret, "whsec_123");
  assert.deepEqual(payload.analysisPlan.structuredDataSchema.properties.outcome.enum, [
    "interested",
    "not_now",
  ]);
  assert.equal(payload.name, "Summer Upsell — Enthusiastic (A)");
});

test("buildCallPayload maps lead + assistant + injected variables", () => {
  const payload = buildCallPayload({
    vapiAssistantId: "asst_1",
    phoneNumberId: "pn_1",
    leadPhone: "+919876543210",
    leadName: "Sarah Khan",
    variableValues: { "lead.firstName": "Sarah", "campaign.calendlyLink": "https://cal.com/x" },
  }) as any;
  assert.equal(payload.assistantId, "asst_1");
  assert.equal(payload.phoneNumberId, "pn_1");
  assert.equal(payload.customer.number, "+919876543210");
  // dotted keys are nested so {{lead.firstName}} resolves under LiquidJS
  assert.equal(payload.assistantOverrides.variableValues.lead.firstName, "Sarah");
  assert.equal(payload.assistantOverrides.variableValues.campaign.calendlyLink, "https://cal.com/x");
});

test("isVapiConfigured reflects presence of an API key", () => {
  assert.equal(isVapiConfigured({ apiKey: null, phoneNumberId: null, webhookSecret: null }), false);
  assert.equal(isVapiConfigured({ apiKey: "k", phoneNumberId: null, webhookSecret: null }), true);
});

test("createAssistant returns a structured error when no key is configured (keys-last)", async () => {
  const result = await createAssistant(
    { apiKey: null, phoneNumberId: null, webhookSecret: null },
    baseAssistant,
  );
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /not configured/i);
});

// ── Webhook verification ──────────────────────────────────────────────────────

test("verifyWebhook accepts a matching secret", () => {
  assert.deepEqual(
    verifyWebhook({ provided: "s3cr3t", expected: "s3cr3t", enforce: true }),
    { ok: true },
  );
});

test("verifyWebhook rejects a mismatching secret when enforced", () => {
  const r = verifyWebhook({ provided: "wrong", expected: "s3cr3t", enforce: true });
  assert.equal(r.ok, false);
});

test("verifyWebhook skips verification in dev when not enforced", () => {
  assert.deepEqual(verifyWebhook({ provided: null, expected: null, enforce: false }), { ok: true });
  assert.deepEqual(verifyWebhook({ provided: null, expected: "s", enforce: false }), { ok: true });
});

test("verifyWebhook fails closed when enforced but secret missing", () => {
  const r = verifyWebhook({ provided: "x", expected: null, enforce: true });
  assert.equal(r.ok, false);
});
