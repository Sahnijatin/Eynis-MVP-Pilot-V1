import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";

// ── Test harness ──────────────────────────────────────────────────────────────

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

const createHotel = async (hotelId: string) => {
  await prisma.hotel.create({ data: { id: hotelId, name: "VC " + hotelId.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { hotelId, plan: "growth", maxSeats: 25 } });
};

const createUser = async (
  hotelId: string,
  role: "owner" | "front_desk" | "housekeeping" | "fnb_manager",
  email: string,
) => {
  await prisma.user.create({ data: { hotelId, fullName: "U " + role, email, role, isActive: true } });
};

async function startServer(): Promise<{ server: Server; base: string }> {
  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bind failed");
  return { server, base: "http://127.0.0.1:" + addr.port };
}
const stop = (server: Server) =>
  new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));

const authHeaders = async (base: string, hotelId: string, email: string, role: string) => {
  const r = await fetch(base + "/auth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hotelId, email, role }),
  });
  const p = (await r.json()) as { token?: string };
  if (!p.token) throw new Error("no token");
  return { authorization: "Bearer " + p.token, "content-type": "application/json" };
};

const validCampaign = {
  name: "Summer Upsell",
  scriptTemplate: "Hi {lead.firstName}, want an upgrade?",
  voiceA: "Rachel", voiceB: "Aria",
  personaA: "Enthusiastic", personaB: "Sophisticated",
  outcomeTypes: ["interested", "not_now"],
  followUpRules: { interested: ["whatsapp", "email"] },
};

after(async () => { await prisma.$disconnect(); });

// ── Tests ─────────────────────────────────────────────────────────────────────

test("campaign CRUD lifecycle (create, list, detail, patch, complete, delete)", async () => {
  const hotelId = "vc-" + uid();
  await createHotel(hotelId);
  const email = `owner+${hotelId}@test.local`;
  await createUser(hotelId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, hotelId, email, "owner");

    // create
    const createRes = await fetch(base + "/campaigns", { method: "POST", headers, body: JSON.stringify(validCampaign) });
    const created = (await createRes.json()) as any;
    assert.equal(createRes.status, 201);
    assert.equal(created.campaign.status, "draft");
    assert.deepEqual(created.campaign.outcomeTypes, ["interested", "not_now"]);
    assert.deepEqual(created.campaign.followUpRules, { interested: ["whatsapp", "email"] });
    const id = created.campaign.id as string;

    // list with stats
    const listRes = await fetch(base + "/campaigns", { headers });
    const list = (await listRes.json()) as any;
    assert.equal(listRes.status, 200);
    assert.equal(list.items.length, 1);
    assert.equal(list.items[0].stats.totalLeads, 0);

    // detail with breakdown
    const detailRes = await fetch(base + `/campaigns/${id}`, { headers });
    const detail = (await detailRes.json()) as any;
    assert.equal(detailRes.status, 200);
    assert.deepEqual(detail.stats.outcomeBreakdown, {});

    // patch
    const patchRes = await fetch(base + `/campaigns/${id}`, {
      method: "PATCH", headers, body: JSON.stringify({ name: "Renamed", maxConcurrent: 9 }),
    });
    const patched = (await patchRes.json()) as any;
    assert.equal(patchRes.status, 200);
    assert.equal(patched.campaign.name, "Renamed");
    assert.equal(patched.campaign.maxConcurrent, 9);

    // complete
    const completeRes = await fetch(base + `/campaigns/${id}/complete`, { method: "POST", headers });
    assert.equal(completeRes.status, 200);
    assert.equal(((await completeRes.json()) as any).campaign.status, "completed");

    // delete (no call records) → ok
    const delRes = await fetch(base + `/campaigns/${id}`, { method: "DELETE", headers });
    assert.equal(delRes.status, 200);
    const gone = await fetch(base + `/campaigns/${id}`, { headers });
    assert.equal(gone.status, 404);
  } finally {
    await stop(server);
  }
});

test("create validation rejects missing required fields", async () => {
  const hotelId = "vc-" + uid();
  await createHotel(hotelId);
  const email = `owner+${hotelId}@test.local`;
  await createUser(hotelId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, hotelId, email, "owner");
    const res = await fetch(base + "/campaigns", { method: "POST", headers, body: JSON.stringify({ name: "x" }) });
    assert.equal(res.status, 400);
    assert.equal(((await res.json()) as any).ok, false);
  } finally {
    await stop(server);
  }
});

test("activate without Vapi configured returns 400; pause guard rejects non-active", async () => {
  const hotelId = "vc-" + uid();
  await createHotel(hotelId);
  const email = `owner+${hotelId}@test.local`;
  await createUser(hotelId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, hotelId, email, "owner");
    const created = (await (await fetch(base + "/campaigns", { method: "POST", headers, body: JSON.stringify(validCampaign) })).json()) as any;
    const id = created.campaign.id;

    const activateRes = await fetch(base + `/campaigns/${id}/activate`, { method: "POST", headers });
    assert.equal(activateRes.status, 400);
    assert.match(((await activateRes.json()) as any).error, /not configured/i);

    const pauseRes = await fetch(base + `/campaigns/${id}/pause`, { method: "POST", headers });
    assert.equal(pauseRes.status, 409); // still draft, cannot pause
  } finally {
    await stop(server);
  }
});

test("delete is blocked (409) when call records exist", async () => {
  const hotelId = "vc-" + uid();
  await createHotel(hotelId);
  const email = `owner+${hotelId}@test.local`;
  await createUser(hotelId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, hotelId, email, "owner");
    const created = (await (await fetch(base + "/campaigns", { method: "POST", headers, body: JSON.stringify(validCampaign) })).json()) as any;
    const id = created.campaign.id;
    const lead = await prisma.campaignLead.create({ data: { campaignId: id, hotelId, firstName: "S", phone: "+91900" + uid().slice(0, 6) } });
    await prisma.callRecord.create({ data: { campaignId: id, leadId: lead.id, hotelId, abVariant: "A", status: "ended" } });

    const delRes = await fetch(base + `/campaigns/${id}`, { method: "DELETE", headers });
    assert.equal(delRes.status, 409);
  } finally {
    await stop(server);
  }
});

test("RBAC: housekeeping role cannot access campaigns (403)", async () => {
  const hotelId = "vc-" + uid();
  await createHotel(hotelId);
  const email = `hk+${hotelId}@test.local`;
  await createUser(hotelId, "housekeeping", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, hotelId, email, "housekeeping");
    const res = await fetch(base + "/campaigns", { headers });
    assert.equal(res.status, 403);
  } finally {
    await stop(server);
  }
});

test("tenant isolation: cannot read another hotel's campaign", async () => {
  const hotelA = "vc-a-" + uid();
  const hotelB = "vc-b-" + uid();
  await createHotel(hotelA);
  await createHotel(hotelB);
  const emailA = `owner+${hotelA}@test.local`;
  const emailB = `owner+${hotelB}@test.local`;
  await createUser(hotelA, "owner", emailA);
  await createUser(hotelB, "owner", emailB);
  const { server, base } = await startServer();
  try {
    const headersA = await authHeaders(base, hotelA, emailA, "owner");
    const headersB = await authHeaders(base, hotelB, emailB, "owner");
    const created = (await (await fetch(base + "/campaigns", { method: "POST", headers: headersA, body: JSON.stringify(validCampaign) })).json()) as any;
    const id = created.campaign.id;

    const crossRes = await fetch(base + `/campaigns/${id}`, { headers: headersB });
    assert.equal(crossRes.status, 404);
  } finally {
    await stop(server);
  }
});
