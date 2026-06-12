import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";
import { seedDefaultRolesForHotel } from "../rbac";
import { keywordRecommend, type ConciergePlace } from "./concierge";

// ── Test harness (mirrors crm/deals-routes.test.ts) ───────────────────────────

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

const createHotel = async (tenantId: string) => {
  await prisma.tenant.create({ data: { id: tenantId, name: "Disc " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId, plan: "growth", maxSeats: 25 } });
};
const createUser = async (tenantId: string, role: string, email: string) => {
  await prisma.user.create({ data: { tenantId, fullName: "U " + role, email, role, isActive: true } });
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

const authHeaders = async (base: string, tenantId: string, email: string, role: string) => {
  const r = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId, email, role }),
  });
  const p = (await r.json()) as { token?: string };
  if (!p.token) throw new Error("no token");
  return { authorization: "Bearer " + p.token, "content-type": "application/json" };
};

const samplePlace = (over: Record<string, unknown> = {}) => ({
  name: "Sunset Shack", category: "cafe", description: "Beachfront coffee and pancakes",
  lat: 15.54, lng: 73.76, address: "Calangute", rating: 4.5, priceLevel: 2,
  tags: ["coffee", "breakfast", "beachfront"], ...over,
});

after(async () => { await prisma.$disconnect(); });

// ── Tests ─────────────────────────────────────────────────────────────────────

test("create → list → get a place; isGolden defaults false", async () => {
  const tenantId = "disc-" + uid();
  const email = `owner-${uid()}@x.com`;
  await createHotel(tenantId);
  await createUser(tenantId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, tenantId, email, "owner");
    const createRes = await fetch(base + "/places", { method: "POST", headers, body: JSON.stringify(samplePlace()) });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as { ok: boolean; place: { id: string; isGolden: boolean; category: string } };
    assert.equal(created.ok, true);
    assert.equal(created.place.isGolden, false);
    assert.equal(created.place.category, "cafe");

    const listRes = await fetch(base + "/places", { headers });
    const list = (await listRes.json()) as { ok: boolean; items: Array<{ id: string }>; categories: string[] };
    assert.equal(list.ok, true);
    assert.ok(list.items.some((p) => p.id === created.place.id));
    assert.ok(list.categories.includes("cafe"));

    const getRes = await fetch(base + `/places/${created.place.id}`, { headers });
    const got = (await getRes.json()) as { ok: boolean; place: { id: string } };
    assert.equal(got.place.id, created.place.id);
  } finally { await stop(server); }
});

test("create rejects out-of-range coordinates", async () => {
  const tenantId = "disc-" + uid();
  const email = `owner-${uid()}@x.com`;
  await createHotel(tenantId);
  await createUser(tenantId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, tenantId, email, "owner");
    const res = await fetch(base + "/places", { method: "POST", headers, body: JSON.stringify(samplePlace({ lat: 200 })) });
    assert.equal(res.status, 400);
  } finally { await stop(server); }
});

test("golden provisioning toggles isGolden and golden=true filter", async () => {
  const tenantId = "disc-" + uid();
  const email = `owner-${uid()}@x.com`;
  await createHotel(tenantId);
  await createUser(tenantId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, tenantId, email, "owner");
    const created = (await (await fetch(base + "/places", { method: "POST", headers, body: JSON.stringify(samplePlace()) })).json()) as { place: { id: string } };
    const id = created.place.id;

    const goldRes = await fetch(base + `/places/${id}/golden`, { method: "POST", headers, body: JSON.stringify({ tier: "premium", months: 3 }) });
    const gold = (await goldRes.json()) as { ok: boolean; place: { isGolden: boolean; goldenTier: string } };
    assert.equal(gold.place.isGolden, true);
    assert.equal(gold.place.goldenTier, "premium");

    const goldenList = (await (await fetch(base + "/places?golden=true", { headers })).json()) as { items: Array<{ id: string }> };
    assert.ok(goldenList.items.some((p) => p.id === id));

    // Clear the promotion.
    const cleared = (await (await fetch(base + `/places/${id}/golden`, { method: "POST", headers, body: JSON.stringify({ tier: null }) })).json()) as { place: { isGolden: boolean } };
    assert.equal(cleared.place.isGolden, false);
  } finally { await stop(server); }
});

test("golden rejects an invalid tier", async () => {
  const tenantId = "disc-" + uid();
  const email = `owner-${uid()}@x.com`;
  await createHotel(tenantId);
  await createUser(tenantId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, tenantId, email, "owner");
    const created = (await (await fetch(base + "/places", { method: "POST", headers, body: JSON.stringify(samplePlace()) })).json()) as { place: { id: string } };
    const res = await fetch(base + `/places/${created.place.id}/golden`, { method: "POST", headers, body: JSON.stringify({ tier: "diamond" }) });
    assert.equal(res.status, 400);
  } finally { await stop(server); }
});

test("patch updates fields; delete removes the place", async () => {
  const tenantId = "disc-" + uid();
  const email = `owner-${uid()}@x.com`;
  await createHotel(tenantId);
  await createUser(tenantId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, tenantId, email, "owner");
    const created = (await (await fetch(base + "/places", { method: "POST", headers, body: JSON.stringify(samplePlace()) })).json()) as { place: { id: string } };
    const id = created.place.id;

    const patched = (await (await fetch(base + `/places/${id}`, { method: "PATCH", headers, body: JSON.stringify({ name: "Renamed", tags: ["new"] }) })).json()) as { place: { name: string; tags: string[] } };
    assert.equal(patched.place.name, "Renamed");
    assert.deepEqual(patched.place.tags, ["new"]);

    const del = await fetch(base + `/places/${id}`, { method: "DELETE", headers });
    assert.equal(del.status, 200);
    const after = await fetch(base + `/places/${id}`, { headers });
    assert.equal(after.status, 404);
  } finally { await stop(server); }
});

test("concierge returns recommendations from the tenant's places (keyword fallback)", async () => {
  const tenantId = "disc-" + uid();
  const email = `owner-${uid()}@x.com`;
  await createHotel(tenantId);
  await createUser(tenantId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, tenantId, email, "owner");
    const cafe = (await (await fetch(base + "/places", { method: "POST", headers, body: JSON.stringify(samplePlace({ name: "Coffee Hub", tags: ["coffee", "wifi"] })) })).json()) as { place: { id: string } };
    await fetch(base + "/places", { method: "POST", headers, body: JSON.stringify(samplePlace({ name: "Loud Club", category: "nightlife", tags: ["dancing"], description: "late night club" })) });

    const res = await fetch(base + "/places/concierge", { method: "POST", headers, body: JSON.stringify({ query: "somewhere for coffee" }) });
    assert.equal(res.status, 200);
    const out = (await res.json()) as { ok: boolean; recommendations: Array<{ placeId: string }>; usedAI: boolean };
    assert.equal(out.ok, true);
    assert.equal(out.usedAI, false); // no AI key in test → deterministic fallback
    assert.ok(out.recommendations.some((r) => r.placeId === cafe.place.id), "coffee shop should be recommended for a coffee query");
  } finally { await stop(server); }
});

test("concierge requires a query", async () => {
  const tenantId = "disc-" + uid();
  const email = `owner-${uid()}@x.com`;
  await createHotel(tenantId);
  await createUser(tenantId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, tenantId, email, "owner");
    const res = await fetch(base + "/places/concierge", { method: "POST", headers, body: JSON.stringify({ query: "  " }) });
    assert.equal(res.status, 400);
  } finally { await stop(server); }
});

test("tenant isolation: B cannot read or modify A's place", async () => {
  const tenantA = "disc-" + uid();
  const tenantB = "disc-" + uid();
  const emailA = `a-${uid()}@x.com`;
  const emailB = `b-${uid()}@x.com`;
  await createHotel(tenantA);
  await createHotel(tenantB);
  await createUser(tenantA, "owner", emailA);
  await createUser(tenantB, "owner", emailB);
  const { server, base } = await startServer();
  try {
    const headersA = await authHeaders(base, tenantA, emailA, "owner");
    const headersB = await authHeaders(base, tenantB, emailB, "owner");
    const created = (await (await fetch(base + "/places", { method: "POST", headers: headersA, body: JSON.stringify(samplePlace()) })).json()) as { place: { id: string } };
    const id = created.place.id;

    assert.equal((await fetch(base + `/places/${id}`, { headers: headersB })).status, 404);
    assert.equal((await fetch(base + `/places/${id}`, { method: "PATCH", headers: headersB, body: JSON.stringify({ name: "x" }) })).status, 404);
    assert.equal((await fetch(base + `/places/${id}`, { method: "DELETE", headers: headersB })).status, 404);

    const listB = (await (await fetch(base + "/places", { headers: headersB })).json()) as { items: Array<{ id: string }> };
    assert.ok(!listB.items.some((p) => p.id === id));
  } finally { await stop(server); }
});

test("viewer can browse but cannot curate places", async () => {
  const tenantId = "disc-" + uid();
  const viewerEmail = `viewer-${uid()}@x.com`;
  await createHotel(tenantId);
  await seedDefaultRolesForHotel(tenantId);
  const viewerRole = await prisma.role.findFirst({ where: { tenantId, key: "viewer" } });
  await prisma.user.create({ data: { tenantId, fullName: "Viewer", email: viewerEmail, role: "housekeeping", roleId: viewerRole!.id, isActive: true } });
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, tenantId, viewerEmail, "housekeeping");
    assert.equal((await fetch(base + "/places", { headers })).status, 200); // view_places ✓
    const createRes = await fetch(base + "/places", { method: "POST", headers, body: JSON.stringify(samplePlace()) });
    assert.equal(createRes.status, 403); // no manage_places
  } finally { await stop(server); }
});

test("keywordRecommend ranks golden picks ahead of equal matches", () => {
  const places: ConciergePlace[] = [
    { id: "a", name: "Plain Bar", category: "nightlife", description: null, tags: ["drinks"], rating: 4, priceLevel: 2, isGolden: false },
    { id: "b", name: "Gold Bar", category: "nightlife", description: null, tags: ["drinks"], rating: 4, priceLevel: 2, isGolden: true },
  ];
  const recs = keywordRecommend("drinks nightlife", places);
  assert.equal(recs[0]?.placeId, "b", "golden place should rank first on an equal match");
});
