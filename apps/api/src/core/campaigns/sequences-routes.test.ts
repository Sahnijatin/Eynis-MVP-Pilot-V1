import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
const createHotel = async (hotelId: string) => {
  await prisma.hotel.create({ data: { id: hotelId, name: "VC " + hotelId.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { hotelId, plan: "growth", maxSeats: 25 } });
};
const createUser = (hotelId: string, role: string, email: string) =>
  prisma.user.create({ data: { hotelId, fullName: "U", email, role, isActive: true } });

async function startServer(): Promise<{ server: Server; base: string }> {
  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bind failed");
  return { server, base: "http://127.0.0.1:" + addr.port };
}
const stop = (server: Server) => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
const auth = async (base: string, hotelId: string, email: string) => {
  const r = await fetch(base + "/auth/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ hotelId, email, role: "owner" }) });
  return "Bearer " + ((await r.json()) as { token: string }).token;
};

after(async () => { await prisma.$disconnect(); });

test("sequences: create with steps, enroll leads, list enrollments", async () => {
  const hotelId = "seqr-" + uid();
  await createHotel(hotelId);
  const email = `owner+${hotelId}@test.local`;
  await createUser(hotelId, "owner", email);
  const { server, base } = await startServer();
  try {
    const token = await auth(base, hotelId, email);
    const campaign = await prisma.voiceCampaign.create({ data: { hotelId, name: "C", status: "draft", channels: JSON.stringify(["whatsapp"]) } });
    const l1 = await prisma.campaignLead.create({ data: { campaignId: campaign.id, hotelId, firstName: "A", phone: "+919000020001", consent: true } });
    const l2 = await prisma.campaignLead.create({ data: { campaignId: campaign.id, hotelId, firstName: "B", phone: "+919000020002", consent: true } });

    // create
    const created = await fetch(base + "/sequences", {
      method: "POST", headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({ name: "Welcome drip", steps: [
        { channel: "whatsapp", whatsappContentSid: "HX1" },
        { channel: "email", waitMinutes: 1440, emailSubject: "Hi {lead.firstName}", emailBody: "<p>Hello</p>" },
      ] }),
    });
    assert.equal(created.status, 201);
    const seq = ((await created.json()) as any).sequence;
    assert.equal(seq.steps.length, 2);
    assert.equal(seq.status, "draft");

    // enroll an empty-step sequence is blocked? here it has steps. enroll two leads.
    const enroll = await fetch(base + `/sequences/${seq.id}/enroll`, {
      method: "POST", headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({ leadIds: [l1.id, l2.id] }),
    });
    const enrollBody = (await enroll.json()) as any;
    assert.equal(enrollBody.enrolled, 2);

    // re-enrolling is idempotent
    const again = await fetch(base + `/sequences/${seq.id}/enroll`, {
      method: "POST", headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({ leadIds: [l1.id, l2.id] }),
    });
    assert.equal(((await again.json()) as any).enrolled, 0);

    // list enrollments
    const list = await (await fetch(base + `/sequences/${seq.id}/enrollments`, { headers: { authorization: token } })).json() as any;
    assert.equal(list.page.total, 2);

    // activate via PATCH
    const patched = await fetch(base + `/sequences/${seq.id}`, { method: "PATCH", headers: { authorization: token, "content-type": "application/json" }, body: JSON.stringify({ status: "active" }) });
    assert.equal(((await patched.json()) as any).sequence.status, "active");
  } finally {
    await stop(server);
  }
});

test("sequences: enroll by segment; tenant isolation 404", async () => {
  const hotelId = "seqr-" + uid();
  await createHotel(hotelId);
  const email = `owner+${hotelId}@test.local`;
  await createUser(hotelId, "owner", email);
  const { server, base } = await startServer();
  try {
    const token = await auth(base, hotelId, email);
    const campaign = await prisma.voiceCampaign.create({ data: { hotelId, name: "C", status: "draft", channels: JSON.stringify(["whatsapp"]) } });
    await prisma.campaignLead.create({ data: { campaignId: campaign.id, hotelId, firstName: "G", phone: "+919000020101", consent: true, tags: ["gold"] } });
    await prisma.campaignLead.create({ data: { campaignId: campaign.id, hotelId, firstName: "S", phone: "+919000020102", consent: true, tags: ["silver"] } });
    const segment = await prisma.leadSegment.create({ data: { hotelId, name: "Gold", rules: JSON.stringify({ tagsAny: ["gold"] }) } });
    const seq = await prisma.sequence.create({ data: { hotelId, name: "S", status: "active", steps: { create: [{ order: 0, waitMinutes: 0, channel: "whatsapp", whatsappContentSid: "HX" }] } } });

    const enroll = await fetch(base + `/sequences/${seq.id}/enroll`, {
      method: "POST", headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({ segmentId: segment.id }),
    });
    assert.equal(((await enroll.json()) as any).enrolled, 1); // only the gold lead

    // another tenant cannot see this sequence
    const otherHotel = "seqr-" + uid();
    await createHotel(otherHotel);
    const oEmail = `owner+${otherHotel}@test.local`;
    await createUser(otherHotel, "owner", oEmail);
    const oToken = await auth(base, otherHotel, oEmail);
    const leak = await fetch(base + `/sequences/${seq.id}`, { headers: { authorization: oToken } });
    assert.equal(leak.status, 404);
  } finally {
    await stop(server);
  }
});
