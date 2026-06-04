import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";
import { processCampaignChannel } from "./dispatch";
import type { ChannelSender } from "./senders";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

const createHotel = async (hotelId: string) => {
  await prisma.tenant.create({ data: { id: hotelId, name: "VC " + hotelId.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { hotelId, plan: "growth", maxSeats: 25 } });
};
const createUser = (hotelId: string, role: string, email: string) =>
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
  return "Bearer " + ((await r.json()) as { token: string }).token;
};

const fakeSender = (channel: string): ChannelSender => ({
  channel, async send() { return { ok: true, providerId: "m", renderedBody: "hi" }; },
});
const sendDeps = { resolveSender: (c: string) => fakeSender(c), batchSize: 100 };

after(async () => { await prisma.$disconnect(); });

test("segments: CRUD + preview, and tenant isolation", async () => {
  const hotelId = "seg-" + uid();
  await createHotel(hotelId);
  const email = `owner+${hotelId}@test.local`;
  await createUser(hotelId, "owner", email);
  const { server, base } = await startServer();
  try {
    const token = await authHeaders(base, hotelId, email, "owner");
    const campaign = await prisma.voiceCampaign.create({ data: { hotelId, name: "C", status: "draft", channels: JSON.stringify(["whatsapp"]) } });
    await prisma.campaignLead.create({ data: { campaignId: campaign.id, hotelId, firstName: "Gold", phone: "+919000000101", consent: true, tags: ["vip", "gold"] } });
    await prisma.campaignLead.create({ data: { campaignId: campaign.id, hotelId, firstName: "Plain", phone: "+919000000102", consent: true, tags: [] } });

    // create
    const created = await fetch(base + "/segments", {
      method: "POST", headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({ name: "VIPs", rules: { tagsAny: ["vip"], consent: true } }),
    });
    assert.equal(created.status, 201);
    const segId = ((await created.json()) as any).segment.id;

    // list
    const list = await (await fetch(base + "/segments", { headers: { authorization: token } })).json() as any;
    assert.equal(list.items.length, 1);
    assert.deepEqual(list.items[0].rules.tagsAny, ["vip"]);

    // preview within the campaign → only the tagged lead matches
    const prev = await (await fetch(base + `/segments/${segId}/preview?campaignId=${campaign.id}`, { headers: { authorization: token } })).json() as any;
    assert.equal(prev.total, 1);
    assert.equal(prev.sample[0].firstName, "Gold");

    // patch
    const patched = await fetch(base + `/segments/${segId}`, {
      method: "PATCH", headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({ name: "VIP customers" }),
    });
    assert.equal(((await patched.json()) as any).segment.name, "VIP customers");

    // another tenant cannot see it
    const otherHotel = "seg-" + uid();
    await createHotel(otherHotel);
    const otherEmail = `owner+${otherHotel}@test.local`;
    await createUser(otherHotel, "owner", otherEmail);
    const otherToken = await authHeaders(base, otherHotel, otherEmail, "owner");
    const leak = await fetch(base + `/segments/${segId}`, { headers: { authorization: otherToken } });
    assert.equal(leak.status, 404);

    // delete
    const del = await fetch(base + `/segments/${segId}`, { method: "DELETE", headers: { authorization: token } });
    assert.equal(del.status, 200);
    assert.equal((await (await fetch(base + "/segments", { headers: { authorization: token } })).json() as any).items.length, 0);
  } finally {
    await stop(server);
  }
});

test("lead tagging: single PATCH + bulk add/remove, and ?tag= filter", async () => {
  const hotelId = "seg-" + uid();
  await createHotel(hotelId);
  const email = `owner+${hotelId}@test.local`;
  await createUser(hotelId, "owner", email);
  const { server, base } = await startServer();
  try {
    const token = await authHeaders(base, hotelId, email, "owner");
    const campaign = await prisma.voiceCampaign.create({ data: { hotelId, name: "C", status: "draft", channels: JSON.stringify(["whatsapp"]) } });
    const l1 = await prisma.campaignLead.create({ data: { campaignId: campaign.id, hotelId, firstName: "A", phone: "+919000000201", consent: true } });
    const l2 = await prisma.campaignLead.create({ data: { campaignId: campaign.id, hotelId, firstName: "B", phone: "+919000000202", consent: true } });

    // single PATCH sets tags (deduped)
    const patch = await fetch(base + `/campaigns/${campaign.id}/leads/${l1.id}`, {
      method: "PATCH", headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({ tags: ["vip", "vip", " gold "] }),
    });
    assert.equal(patch.status, 200);
    assert.deepEqual(((await patch.json()) as any).lead.tags, ["vip", "gold"]);

    // bulk add to both, remove "gold" from l1
    const bulk = await fetch(base + `/campaigns/${campaign.id}/leads/tag`, {
      method: "POST", headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({ leadIds: [l1.id, l2.id], addTags: ["india"], removeTags: ["gold"] }),
    });
    assert.equal(((await bulk.json()) as any).updated, 2);

    // ?tag= filter
    const tagged = await (await fetch(base + `/campaigns/${campaign.id}/leads?tag=india`, { headers: { authorization: token } })).json() as any;
    assert.equal(tagged.page.total, 2);
    const vip = await (await fetch(base + `/campaigns/${campaign.id}/leads?tag=vip`, { headers: { authorization: token } })).json() as any;
    assert.equal(vip.page.total, 1);
    assert.equal(vip.items[0].id, l1.id);
  } finally {
    await stop(server);
  }
});

test("targeting: a campaign with a segment only contacts matching leads", async () => {
  const hotelId = "seg-" + uid();
  await createHotel(hotelId);
  const segment = await prisma.leadSegment.create({ data: { hotelId, name: "Gold", rules: JSON.stringify({ tagsAny: ["gold"] }) } });
  const campaign = await prisma.voiceCampaign.create({
    data: { hotelId, name: "Targeted", status: "active", channels: JSON.stringify(["whatsapp"]), whatsappContentSid: "HX", segmentId: segment.id },
  });
  // two match the segment, one does not
  await prisma.campaignLead.create({ data: { campaignId: campaign.id, hotelId, firstName: "G1", phone: "+919000000301", consent: true, consentSource: "csv_import", tags: ["gold"] } });
  await prisma.campaignLead.create({ data: { campaignId: campaign.id, hotelId, firstName: "G2", phone: "+919000000302", consent: true, consentSource: "csv_import", tags: ["gold", "vip"] } });
  await prisma.campaignLead.create({ data: { campaignId: campaign.id, hotelId, firstName: "X", phone: "+919000000303", consent: true, consentSource: "csv_import", tags: ["silver"] } });

  const r = await processCampaignChannel(campaign.id, "whatsapp", sendDeps);
  assert.equal(r.sent, 2); // only the two gold leads
  const contacted = await prisma.messageDelivery.findMany({ where: { campaignId: campaign.id }, select: { leadId: true } });
  assert.equal(contacted.length, 2);
});
