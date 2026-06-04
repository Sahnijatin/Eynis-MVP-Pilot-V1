import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

const createHotel = async (hotelId: string) => {
  await prisma.tenant.create({ data: { id: hotelId, name: "VC " + hotelId.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { hotelId, plan: "growth", maxSeats: 25 } });
};
const createUser = async (hotelId: string, role: string, email: string) =>
  prisma.user.create({ data: { hotelId, fullName: "U " + role, email, role, isActive: true } });

async function startServer(): Promise<{ server: Server; base: string }> {
  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bind failed");
  return { server, base: "http://127.0.0.1:" + addr.port };
}
const stop = (server: Server) => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));

const authHeaders = async (base: string, hotelId: string, email: string, role: string) => {
  const r = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ hotelId, email, role }),
  });
  const p = (await r.json()) as { token?: string };
  if (!p.token) throw new Error("no token");
  return "Bearer " + p.token;
};

after(async () => { await prisma.$disconnect(); });

test("GET deliveries: returns campaign sends newest-first, filterable by channel/status", async () => {
  const hotelId = "vc-" + uid();
  await createHotel(hotelId);
  const email = `owner+${hotelId}@test.local`;
  await createUser(hotelId, "owner", email);
  const { server, base } = await startServer();
  try {
    const token = await authHeaders(base, hotelId, email, "owner");
    const campaign = await prisma.voiceCampaign.create({
      data: { hotelId, name: "Feed", status: "active", channels: JSON.stringify(["whatsapp", "email"]) },
    });
    const lead = await prisma.campaignLead.create({ data: { campaignId: campaign.id, hotelId, firstName: "A", phone: "+919000000001", consent: true } });

    // Three deliveries across channels/statuses; createdAt ordering controlled explicitly.
    await prisma.messageDelivery.create({ data: { hotelId, campaignId: campaign.id, leadId: lead.id, channel: "whatsapp", status: "sent", renderedBody: "hi", createdAt: new Date(Date.now() - 3000) } });
    await prisma.messageDelivery.create({ data: { hotelId, campaignId: campaign.id, leadId: lead.id, channel: "email", status: "failed", error: "bounced", createdAt: new Date(Date.now() - 2000) } });
    await prisma.messageDelivery.create({ data: { hotelId, campaignId: campaign.id, leadId: lead.id, channel: "whatsapp", status: "delivered", createdAt: new Date(Date.now() - 1000) } });

    const all = await fetch(base + `/campaigns/${campaign.id}/deliveries`, { headers: { authorization: token } });
    assert.equal(all.status, 200);
    const body = (await all.json()) as any;
    assert.equal(body.page.total, 3);
    assert.equal(body.items.length, 3);
    // newest first
    assert.equal(body.items[0].status, "delivered");
    assert.equal(body.items[0].lead.firstName, "A");

    const wa = await fetch(base + `/campaigns/${campaign.id}/deliveries?channel=whatsapp`, { headers: { authorization: token } });
    assert.equal((await wa.json() as any).page.total, 2);

    const failed = await fetch(base + `/campaigns/${campaign.id}/deliveries?status=failed`, { headers: { authorization: token } });
    const failedBody = (await failed.json()) as any;
    assert.equal(failedBody.page.total, 1);
    assert.equal(failedBody.items[0].error, "bounced");
  } finally {
    await stop(server);
  }
});

test("GET deliveries: a campaign in another tenant is 404 (no cross-tenant leak)", async () => {
  const hotelA = "vc-" + uid();
  const hotelB = "vc-" + uid();
  await createHotel(hotelA);
  await createHotel(hotelB);
  const emailA = `owner+${hotelA}@test.local`;
  const emailB = `owner+${hotelB}@test.local`;
  await createUser(hotelA, "owner", emailA);
  await createUser(hotelB, "owner", emailB);
  const { server, base } = await startServer();
  try {
    const tokenB = await authHeaders(base, hotelB, emailB, "owner");
    const campaignA = await prisma.voiceCampaign.create({ data: { hotelId: hotelA, name: "A", status: "active", channels: JSON.stringify(["whatsapp"]) } });

    const res = await fetch(base + `/campaigns/${campaignA.id}/deliveries`, { headers: { authorization: tokenB } });
    assert.equal(res.status, 404);
  } finally {
    await stop(server);
  }
});
