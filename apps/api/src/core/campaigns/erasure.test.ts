import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";

// Phase 8: GDPR/DPDP erasure — PII shredded across every campaign surface,
// rows kept for aggregates, phone DNC'd, audit trail carries counts only.

const uid = () => "erasure-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8);
const createdTenants: string[] = [];

async function setup() {
  const tenantId = uid();
  createdTenants.push(tenantId);
  await prisma.tenant.create({ data: { id: tenantId, name: "Erase Co " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId, plan: "growth", maxSeats: 25 } });
  const email = `owner-${tenantId}@example.com`;
  await prisma.user.create({ data: { tenantId, fullName: "Owner", email, role: "owner", isActive: true } });
  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const tokRes = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId, email, role: "owner" }),
  });
  const { token } = (await tokRes.json()) as { token: string };
  const H = { authorization: "Bearer " + token, "content-type": "application/json" };
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return { tenantId, base, H, close };
}

after(async () => {
  for (const id of createdTenants) await prisma.tenant.deleteMany({ where: { id } });
  await prisma.$disconnect();
});

async function seedPerson(tenantId: string, phone: string) {
  const campaign = await prisma.voiceCampaign.create({
    data: { tenantId, name: "Erasure test " + phone, status: "active", channels: JSON.stringify(["voice"]) },
  });
  const lead = await prisma.campaignLead.create({
    data: {
      tenantId, campaignId: campaign.id, firstName: "Devika", lastName: "Sharma",
      phone, email: "devika@example.com", company: "Sharma Textiles", jobTitle: "Director",
      rawData: JSON.stringify({ note: "met at expo" }), consent: true, consentSource: "event_signup",
    },
  });
  const call = await prisma.callRecord.create({
    data: {
      tenantId, campaignId: campaign.id, leadId: lead.id, abVariant: "A", status: "ended",
      outcome: "interested", transcript: "Devika said she is interested in bulk pricing.",
      aiSummary: "Devika Sharma wants bulk pricing.", keyPoints: JSON.stringify(["bulk pricing"]),
      sentiment: "positive", durationSeconds: 120,
    },
  });
  await prisma.sentimentEvent.create({
    data: { tenantId, callRecordId: call.id, speaker: "customer", text: "I would love bulk pricing for Sharma Textiles", sentiment: "positive", score: 0.7 },
  });
  const conversation = await prisma.whatsappConversation.create({
    data: { tenantId, campaignId: campaign.id, leadId: lead.id, threadSummary: "Devika asked for a catalogue" },
  });
  await prisma.whatsappMessage.create({
    data: { tenantId, conversationId: conversation.id, direction: "in", body: "Hi, I'm Devika — send the catalogue please", sentiment: "positive", score: 0.5 },
  });
  await prisma.messageDelivery.create({
    data: { tenantId, campaignId: campaign.id, leadId: lead.id, channel: "email", status: "sent", renderedSubject: "Catalogue for Devika", renderedBody: "Hi Devika, catalogue attached." },
  });
  return { campaign, lead, call, conversation };
}

test("POST /campaigns/erasure shreds PII across all surfaces, keeps rows, DNCs the phone, audits counts", async () => {
  const { tenantId, base, H, close } = await setup();
  try {
    const phone = "+919812399001";
    const { lead, call, conversation } = await seedPerson(tenantId, phone);

    const res = await fetch(base + "/campaigns/erasure", { method: "POST", headers: H, body: JSON.stringify({ phone }) });
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean; counts: Record<string, number> };
    assert.equal(body.counts.leads, 1);
    assert.equal(body.counts.callRecords, 1);
    assert.equal(body.counts.whatsappMessages, 1);
    assert.equal(body.counts.deliveries, 1);

    // Rows survive; PII is gone.
    const erased = await prisma.campaignLead.findUnique({ where: { id: lead.id } });
    assert.equal(erased!.firstName, "Erased");
    assert.equal(erased!.phone, null);
    assert.equal(erased!.email, null);
    assert.equal(erased!.company, null);
    assert.equal(erased!.rawData, "{}");
    assert.equal(erased!.optedOut, true);
    const erasedCall = await prisma.callRecord.findUnique({ where: { id: call.id } });
    assert.equal(erasedCall!.transcript, null);
    assert.equal(erasedCall!.aiSummary, null);
    assert.equal(erasedCall!.outcome, "interested", "aggregate fields (outcome) survive");
    const sentiment = await prisma.sentimentEvent.findFirst({ where: { callRecordId: call.id } });
    assert.equal(sentiment!.text, "[erased]");
    assert.equal(sentiment!.sentiment, "positive", "sentiment aggregate survives");
    const msg = await prisma.whatsappMessage.findFirst({ where: { conversationId: conversation.id } });
    assert.equal(msg!.body, "[erased]");
    const delivery = await prisma.messageDelivery.findFirst({ where: { tenantId, leadId: lead.id } });
    assert.equal(delivery!.renderedSubject, null);
    assert.equal(delivery!.renderedBody, null);

    // Phone suppressed for good.
    const dnc = await prisma.doNotContact.findUnique({ where: { tenantId_phone: { tenantId, phone } } });
    assert.equal(dnc!.reason, "gdpr_erasure");

    // Audit row exists and carries NO PII.
    const audit = await prisma.auditLog.findFirst({ where: { tenantId, action: "campaign_lead_erasure" } });
    assert.ok(audit);
    assert.ok(!audit!.metadata.includes("Devika") && !audit!.metadata.includes(phone), "audit metadata is PII-free");

    // Unknown selector → 404; no selector → 400.
    assert.equal((await fetch(base + "/campaigns/erasure", { method: "POST", headers: H, body: JSON.stringify({ phone: "+911111111111" }) })).status, 404);
    assert.equal((await fetch(base + "/campaigns/erasure", { method: "POST", headers: H, body: "{}" })).status, 400);
  } finally {
    await close();
  }
});

test("erasure by phone covers every campaign the person appears in; tenant-scoped", async () => {
  const a = await setup();
  const b = await setup();
  try {
    const phone = "+919812399002";
    await seedPerson(a.tenantId, phone);
    await seedPerson(a.tenantId, phone); // same person, second campaign
    const other = await seedPerson(b.tenantId, phone); // same phone, DIFFERENT tenant

    const res = await fetch(a.base + "/campaigns/erasure", { method: "POST", headers: a.H, body: JSON.stringify({ phone }) });
    const body = (await res.json()) as { counts: { leads: number } };
    assert.equal(body.counts.leads, 2, "all of tenant A's leads for the person erased");

    // Tenant B's data is untouched.
    const bLead = await prisma.campaignLead.findUnique({ where: { id: other.lead.id } });
    assert.equal(bLead!.firstName, "Devika");
    assert.equal(bLead!.phone, phone);
  } finally {
    await a.close();
    await b.close();
  }
});

test("connector test endpoint: unknown key 404, unconfigured key reports a clear failure, untestable key says so", async () => {
  const { base, H, close } = await setup();
  try {
    assert.equal((await fetch(base + "/connectors/configs/not-a-connector/test", { method: "POST", headers: H, body: "{}" })).status, 404);

    // Configured catalog key with no credentials: testable but fails with a reason.
    const vapi = await fetch(base + "/connectors/configs/voice_vapi/test", { method: "POST", headers: H, body: "{}" });
    assert.equal(vapi.status, 200);
    const vapiBody = (await vapi.json()) as { ok: boolean; testable: boolean; passed: boolean; detail: string };
    assert.equal(vapiBody.testable, true);
    assert.equal(vapiBody.passed, false);
    assert.match(vapiBody.detail, /not configured/i);

    // File-export connector: explicitly not live-testable.
    const busy = await fetch(base + "/connectors/configs/accounting_busy/test", { method: "POST", headers: H, body: "{}" });
    const busyBody = (await busy.json()) as { ok: boolean; testable: boolean };
    assert.equal(busyBody.testable, false);
  } finally {
    await close();
  }
});
