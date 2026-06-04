import test from "node:test";
import assert from "node:assert/strict";
import { renderWhatsappContentVariables, contextVars, getSender, MESSAGING_CHANNELS, type SendContext } from "./senders";

test("renderWhatsappContentVariables renders ordered, 1-indexed ContentVariables", () => {
  assert.deepEqual(
    renderWhatsappContentVariables(["{lead.firstName}", "{campaign.name}"], { "lead.firstName": "Sarah", "campaign.name": "Upsell" }),
    { "1": "Sarah", "2": "Upsell" },
  );
  assert.deepEqual(renderWhatsappContentVariables([], {}), {});
});

test("contextVars flattens lead + campaign + tenant incl. custom fields", () => {
  const ctx: SendContext = {
    hotelId: "h1",
    tenantName: "The Riviera",
    campaign: { name: "Upsell", calendlyLink: "https://cal.com/x", whatsappContentSid: null, whatsappTemplateBody: null, whatsappVariables: [], emailSubjectTemplate: null, emailBodyTemplate: null },
    lead: { firstName: "Sarah", lastName: null, phone: "+91999", email: "s@x.com", company: "Acme", jobTitle: null, rawData: JSON.stringify({ tier: "gold" }) },
  };
  const vars = contextVars(ctx);
  assert.equal(vars["lead.firstName"], "Sarah");
  assert.equal(vars["lead.custom.tier"], "gold");
  assert.equal(vars["campaign.name"], "Upsell");
  assert.equal(vars["tenant.name"], "The Riviera");
  assert.equal(vars["booking.calendlyLink"], "https://cal.com/x");
});

test("registry exposes whatsapp + email senders", () => {
  assert.deepEqual(MESSAGING_CHANNELS.sort(), ["email", "whatsapp"]);
  assert.equal(getSender("whatsapp")?.channel, "whatsapp");
  assert.equal(getSender("email")?.channel, "email");
  assert.equal(getSender("sms"), null);
});

test("whatsapp sender fails cleanly when the lead has no phone", async () => {
  const sender = getSender("whatsapp")!;
  const result = await sender.send({
    hotelId: "h1", tenantName: null,
    campaign: { name: "C", calendlyLink: null, whatsappContentSid: "HX1", whatsappTemplateBody: null, whatsappVariables: [], emailSubjectTemplate: null, emailBodyTemplate: null },
    lead: { firstName: "A", lastName: null, phone: null, email: null, company: null, jobTitle: null, rawData: null },
  });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /no phone/);
});
