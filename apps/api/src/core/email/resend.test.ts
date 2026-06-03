import test from "node:test";
import assert from "node:assert/strict";
import {
  renderTemplate,
  buildTemplateVars,
  isResendConfigured,
  sendFollowUpEmail,
} from "./resend";

// ── renderTemplate ────────────────────────────────────────────────────────────

test("renderTemplate substitutes known {variables}", () => {
  const out = renderTemplate("Hi {lead.firstName}, book at {booking.calendlyLink}", {
    "lead.firstName": "Sarah",
    "booking.calendlyLink": "https://cal.com/riviera",
  });
  assert.equal(out, "Hi Sarah, book at https://cal.com/riviera");
});

test("renderTemplate blanks unknown placeholders (no leaked braces)", () => {
  assert.equal(renderTemplate("Hi {lead.firstName}{unknown.var}!", { "lead.firstName": "A" }), "Hi A!");
});

// ── buildTemplateVars ─────────────────────────────────────────────────────────

test("buildTemplateVars flattens namespaces incl. lead.custom.* from rawData", () => {
  const vars = buildTemplateVars({
    lead: { firstName: "Sarah", company: "Acme", rawData: JSON.stringify({ tier: "gold", region: "APAC" }) },
    campaign: { name: "Upsell", calendlyLink: "https://cal.com/x" },
    tenant: { name: "The Riviera" },
    call: { sentiment: "positive", keyPoints: ["wants upgrade", "weekend stay"] },
  });
  assert.equal(vars["lead.firstName"], "Sarah");
  assert.equal(vars["lead.company"], "Acme");
  assert.equal(vars["lead.custom.tier"], "gold");
  assert.equal(vars["lead.custom.region"], "APAC");
  assert.equal(vars["campaign.name"], "Upsell");
  assert.equal(vars["tenant.name"], "The Riviera");
  assert.equal(vars["call.keyPoints"], "wants upgrade, weekend stay");
});

test("buildTemplateVars omits null/undefined and survives malformed rawData", () => {
  const vars = buildTemplateVars({ lead: { firstName: "A", lastName: null, rawData: "{not json" } });
  assert.equal(vars["lead.firstName"], "A");
  assert.ok(!("lead.lastName" in vars));
});

test("renderTemplate composes with buildTemplateVars end-to-end", () => {
  const vars = buildTemplateVars({ lead: { firstName: "Sarah" }, tenant: { name: "The Riviera" } });
  assert.equal(
    renderTemplate("Hi {lead.firstName}, thanks from {tenant.name}!", vars),
    "Hi Sarah, thanks from The Riviera!",
  );
});

// ── Config + keys-last send ────────────────────────────────────────────────────

test("isResendConfigured requires both apiKey and fromAddress", () => {
  assert.equal(isResendConfigured({ apiKey: null, fromAddress: null, fromName: null }), false);
  assert.equal(isResendConfigured({ apiKey: "k", fromAddress: null, fromName: null }), false);
  assert.equal(isResendConfigured({ apiKey: "k", fromAddress: "a@b.com", fromName: null }), true);
});

test("sendFollowUpEmail returns a structured error when unconfigured (keys-last)", async () => {
  const result = await sendFollowUpEmail(
    { apiKey: null, fromAddress: null, fromName: null },
    { to: "x@y.com", subjectTemplate: "Hi {lead.firstName}", htmlTemplate: "<p>Hi</p>", vars: {} },
  );
  assert.equal(result.sent, false);
  assert.match(result.error ?? "", /not configured/i);
});
