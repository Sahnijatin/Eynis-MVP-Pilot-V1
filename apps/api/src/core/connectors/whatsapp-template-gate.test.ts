import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../db/prisma";
import { sendApprovedWhatsAppTemplate } from "./whatsapp-outbound";

// #168 — the operational template gate: a business-initiated automated send must go
// through a manager-approved WhatsApp template. This verifies the gate refuses
// unapproved/missing templates and lets an approved one through to the sender.

const tid = "wtg-" + Date.now().toString(36) + Math.random().toString(16).slice(2, 6);

async function tpl(over: Record<string, unknown>): Promise<string> {
  const t = await prisma.messageTemplate.create({
    data: {
      tenantId: tid, name: "Welcome", channel: "whatsapp", category: "utility",
      body: "Welcome {firstName} to room {roomNumber}", variables: JSON.stringify(["firstName", "roomNumber"]),
      status: "draft", ...over,
    },
    select: { id: true },
  });
  return t.id;
}

before(async () => {
  await prisma.tenant.create({ data: { id: tid, name: "Gate Co", timezone: "UTC" } });
});
after(async () => {
  await prisma.messageTemplate.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("a draft (unapproved) template is refused by the gate", async () => {
  const id = await tpl({ status: "draft" });
  const r = await sendApprovedWhatsAppTemplate(tid, "+919812345678", id, { firstName: "A", roomNumber: "1" });
  assert.equal(r.sent, false);
  assert.equal(r.templateNotApproved, true);
});

test("an approved template with no provider Content SID is refused", async () => {
  const id = await tpl({ status: "approved", providerTemplateId: null });
  const r = await sendApprovedWhatsAppTemplate(tid, "+919812345678", id, { firstName: "A", roomNumber: "1" });
  assert.equal(r.sent, false);
  assert.equal(r.templateNotApproved, true);
});

test("a non-existent template id is refused", async () => {
  const r = await sendApprovedWhatsAppTemplate(tid, "+919812345678", "nope-" + tid, { firstName: "A", roomNumber: "1" });
  assert.equal(r.templateNotApproved, true);
});

test("an approved template passes the gate through to the sender", async () => {
  const id = await tpl({ status: "approved", providerTemplateId: "HXcontentsid123" });
  // No Twilio configured in test → the send itself fails, but the failure is a
  // provider/config error, NOT a template-gate rejection: the gate let it through.
  const r = await sendApprovedWhatsAppTemplate(tid, "+919812345678", id, { firstName: "Alice", roomNumber: "204" });
  assert.notEqual(r.templateNotApproved, true, "the gate must not block an approved template");
  assert.equal(r.provider, "twilio", "it reached the Twilio sender");
  assert.equal(r.sent, false); // no live Twilio creds in test
});
