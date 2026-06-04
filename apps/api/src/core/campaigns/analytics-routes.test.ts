import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
let seq = 8000000000;
const phone = () => "+1" + String(seq++);

const createHotel = async (tenantId: string) => {
  await prisma.tenant.create({ data: { id: tenantId, name: "AN " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId, plan: "growth", maxSeats: 25 } });
};
const createUser = (tenantId: string, role: string, email: string) =>
  prisma.user.create({ data: { tenantId, fullName: "U", email, role, isActive: true } });

async function startServer(): Promise<{ server: Server; base: string }> {
  const server = buildServer();
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind");
  return { server, base: "http://127.0.0.1:" + a.port };
}
const stop = (s: Server) => new Promise<void>((res, rej) => s.close((e) => (e ? rej(e) : res())));
const auth = async (base: string, tenantId: string, email: string, role: string) => {
  const r = await fetch(base + "/auth/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId, email, role }) });
  return "Bearer " + ((await r.json()) as { token: string }).token;
};

// Build a campaign with some calls split across A/B.
async function seedCampaign(tenantId: string) {
  const campaign = await prisma.voiceCampaign.create({
    data: { tenantId, name: "C", status: "active", channels: JSON.stringify(["voice"]), scriptTemplate: "Hi", voiceA: "Rachel", voiceB: "Aria", personaA: "E", personaB: "S", vapiAssistantIdA: "a", vapiAssistantIdB: "b" },
  });
  const mk = async (variant: string, outcome: string | null, sentiment: string | null) => {
    const lead = await prisma.campaignLead.create({ data: { campaignId: campaign.id, tenantId, firstName: "L", phone: phone(), consent: true, consentSource: "csv_import" } });
    return prisma.callRecord.create({ data: { tenantId, campaignId: campaign.id, leadId: lead.id, abVariant: variant, status: "ended", outcome, sentiment, durationSeconds: 120, meetingBooked: outcome === "interested" } });
  };
  // A: 2 answered, 1 interested · B: 2 answered, 0 interested · 1 no_answer
  await mk("A", "interested", "positive");
  await mk("A", "not_now", "neutral");
  await mk("B", "not_now", "neutral");
  await mk("B", "not_now", "negative");
  await mk("B", "no_answer", null);
  return campaign.id;
}

after(async () => { await prisma.$disconnect(); });

test("GET /campaigns/:id/analytics returns per-variant funnel + leader gating", async () => {
  const tenantId = "an-" + uid();
  await createHotel(tenantId);
  const email = `o+${tenantId}@t.local`;
  await createUser(tenantId, "owner", email);
  const { server, base } = await startServer();
  try {
    const token = await auth(base, tenantId, email, "owner");
    const campaignId = await seedCampaign(tenantId);
    const res = await fetch(base + `/campaigns/${campaignId}/analytics`, { headers: { authorization: token } });
    const data = (await res.json()) as any;
    assert.equal(res.status, 200);
    assert.equal(data.variantA.dials, 2);
    assert.equal(data.variantA.answered, 2);
    assert.equal(data.variantA.interested, 1);
    assert.equal(data.variantB.answered, 2); // the no_answer one excluded
    assert.equal(data.leadingVariant, "A");
    assert.equal(data.sufficientSample, false); // far below 50/arm
    assert.equal(data.overall.dials, 5);
  } finally {
    await stop(server);
  }
});

test("GET /campaigns/:id/calls lists calls and exports CSV", async () => {
  const tenantId = "an-" + uid();
  await createHotel(tenantId);
  const email = `o+${tenantId}@t.local`;
  await createUser(tenantId, "owner", email);
  const { server, base } = await startServer();
  try {
    const token = await auth(base, tenantId, email, "owner");
    const campaignId = await seedCampaign(tenantId);

    const list = await fetch(base + `/campaigns/${campaignId}/calls`, { headers: { authorization: token } });
    const data = (await list.json()) as any;
    assert.equal(data.items.length, 5);
    assert.ok(data.items[0].lead.firstName);

    const csv = await fetch(base + `/campaigns/${campaignId}/calls?format=csv`, { headers: { authorization: token } });
    assert.equal(csv.headers.get("content-type"), "text/csv");
    assert.match(csv.headers.get("content-disposition") ?? "", /attachment/);
    const text = await csv.text();
    assert.match(text, /^name,company,phone,variant,status,outcome/);
    assert.equal(text.trim().split("\n").length, 6); // header + 5 rows
  } finally {
    await stop(server);
  }
});

test("GET /campaigns/:id/calls/:callId returns the call + sentiment timeline", async () => {
  const tenantId = "an-" + uid();
  await createHotel(tenantId);
  const email = `o+${tenantId}@t.local`;
  await createUser(tenantId, "owner", email);
  const { server, base } = await startServer();
  try {
    const token = await auth(base, tenantId, email, "owner");
    const campaignId = await seedCampaign(tenantId);
    const call = await prisma.callRecord.findFirst({ where: { campaignId } });
    await prisma.sentimentEvent.create({ data: { tenantId, callRecordId: call!.id, speaker: "customer", text: "great", sentiment: "positive", score: 0.8 } });

    const res = await fetch(base + `/campaigns/${campaignId}/calls/${call!.id}`, { headers: { authorization: token } });
    const data = (await res.json()) as any;
    assert.equal(res.status, 200);
    assert.equal(data.call.id, call!.id);
    assert.equal(data.sentimentEvents.length, 1);
    assert.ok(Array.isArray(data.whatsappThread));
  } finally {
    await stop(server);
  }
});
