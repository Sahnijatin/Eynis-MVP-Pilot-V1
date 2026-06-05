import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";
import { seedDefaultRolesForHotel } from "../rbac";

// ── Test harness (mirrors campaigns/routes.test.ts) ───────────────────────────

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

const createHotel = async (tenantId: string) => {
  await prisma.tenant.create({ data: { id: tenantId, name: "CRM " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
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
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId, email, role }),
  });
  const p = (await r.json()) as { token?: string };
  if (!p.token) throw new Error("no token");
  return { authorization: "Bearer " + p.token, "content-type": "application/json" };
};

// Auth via the canonical roleKey (used for generic system roles like viewer that
// have no legacy hospitality role mapping).
const authHeadersByRoleKey = async (base: string, tenantId: string, email: string, roleKey: string) => {
  const r = await fetch(base + "/auth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId, email, roleKey }),
  });
  const p = (await r.json()) as { token?: string };
  if (!p.token) throw new Error("no token");
  return { authorization: "Bearer " + p.token, "content-type": "application/json" };
};

after(async () => { await prisma.$disconnect(); });

// ── Tests ─────────────────────────────────────────────────────────────────────

test("pipeline auto-seeds, deal create/list, and move sets won + closedAt", async () => {
  const tenantId = "crm-" + uid();
  await createHotel(tenantId);
  const email = `owner+${tenantId}@test.local`;
  await createUser(tenantId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, tenantId, email, "owner");

    // GET /pipelines lazily seeds the standard default pipeline.
    const pRes = await fetch(base + "/pipelines", { headers });
    const pBody = (await pRes.json()) as any;
    assert.equal(pRes.status, 200);
    assert.equal(pBody.items.length, 1);
    const pipeline = pBody.items[0];
    assert.equal(pipeline.isDefault, true);
    assert.equal(pipeline.stages.length, 6);
    const leadIn = pipeline.stages[0];
    const wonStage = pipeline.stages.find((s: any) => s.isWon);
    assert.ok(wonStage, "expected a won stage");
    assert.equal(leadIn.name, "Lead In");

    // POST /deals
    const createRes = await fetch(base + "/deals", {
      method: "POST", headers,
      body: JSON.stringify({ title: "Big retreat", value: 100000, stageId: leadIn.id, expectedCloseAt: "2026-07-01" }),
    });
    const created = (await createRes.json()) as any;
    assert.equal(createRes.status, 201);
    assert.equal(created.deal.status, "open");
    assert.equal(created.deal.value, 100000);
    const dealId = created.deal.id;

    // GET /deals lists it
    const listRes = await fetch(base + "/deals", { headers });
    const listed = (await listRes.json()) as any;
    assert.ok(listed.items.some((d: any) => d.id === dealId));

    // GET /deals/forecast — weighted = 100000 * 0.10 (Lead In)
    const fRes = await fetch(base + "/deals/forecast", { headers });
    const fBody = (await fRes.json()) as any;
    assert.equal(fBody.forecast.openCount, 1);
    assert.equal(fBody.forecast.weightedForecast, 10000);

    // POST /deals/:id/move → Won
    const moveRes = await fetch(base + `/deals/${dealId}/move`, {
      method: "POST", headers, body: JSON.stringify({ stageId: wonStage.id }),
    });
    const moved = (await moveRes.json()) as any;
    assert.equal(moveRes.status, 200);
    assert.equal(moved.deal.status, "won");

    // The won deal is closed and no longer counts as open pipeline.
    const detailRes = await fetch(base + `/deals/${dealId}`, { headers });
    const detail = (await detailRes.json()) as any;
    assert.ok(detail.deal.closedAt, "closedAt should be set");
    assert.ok(detail.transitions.length >= 2, "create + move transitions recorded");

    const f2 = (await (await fetch(base + "/deals/forecast", { headers })).json()) as any;
    assert.equal(f2.forecast.openCount, 0);
    assert.equal(f2.forecast.wonCount, 1);
    assert.equal(f2.forecast.winRate, 1);
  } finally {
    await stop(server);
  }
});

test("move rejects a stage that is not in the deal's pipeline", async () => {
  const tenantId = "crm-" + uid();
  await createHotel(tenantId);
  const email = `owner+${tenantId}@test.local`;
  await createUser(tenantId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, tenantId, email, "owner");
    await fetch(base + "/pipelines", { headers }); // seed
    const created = (await (await fetch(base + "/deals", {
      method: "POST", headers, body: JSON.stringify({ title: "X", value: 1 }),
    })).json()) as any;
    const res = await fetch(base + `/deals/${created.deal.id}/move`, {
      method: "POST", headers, body: JSON.stringify({ stageId: "does-not-exist" }),
    });
    assert.equal(res.status, 400);
  } finally {
    await stop(server);
  }
});

test("tenant isolation: another tenant cannot read or move a deal", async () => {
  const tenantA = "crm-" + uid();
  const tenantB = "crm-" + uid();
  await createHotel(tenantA);
  await createHotel(tenantB);
  const emailA = `owner+${tenantA}@test.local`;
  const emailB = `owner+${tenantB}@test.local`;
  await createUser(tenantA, "owner", emailA);
  await createUser(tenantB, "owner", emailB);
  const { server, base } = await startServer();
  try {
    const headersA = await authHeaders(base, tenantA, emailA, "owner");
    const headersB = await authHeaders(base, tenantB, emailB, "owner");
    await fetch(base + "/pipelines", { headers: headersA });
    const created = (await (await fetch(base + "/deals", {
      method: "POST", headers: headersA, body: JSON.stringify({ title: "A's deal", value: 5000 }),
    })).json()) as any;
    const dealId = created.deal.id;

    // Tenant B must not see it.
    const readRes = await fetch(base + `/deals/${dealId}`, { headers: headersB });
    assert.equal(readRes.status, 404);
    const moveRes = await fetch(base + `/deals/${dealId}/move`, {
      method: "POST", headers: headersB, body: JSON.stringify({ stageId: "whatever" }),
    });
    assert.equal(moveRes.status, 404);
  } finally {
    await stop(server);
  }
});

test("viewer role can read deals but cannot create (manage_crm required)", async () => {
  const tenantId = "crm-" + uid();
  await createHotel(tenantId);
  await seedDefaultRolesForHotel(tenantId); // creates the generic system roles incl. viewer
  const viewerEmail = `viewer+${tenantId}@test.local`;
  const viewerRole = await prisma.role.findFirst({ where: { tenantId, key: "viewer" } });
  assert.ok(viewerRole, "viewer role should be seeded");
  await prisma.user.create({
    data: { tenantId, fullName: "Viewer", email: viewerEmail, role: "housekeeping", roleId: viewerRole!.id, isActive: true },
  });
  const { server, base } = await startServer();
  try {
    const viewerHeaders = await authHeadersByRoleKey(base, tenantId, viewerEmail, "viewer");

    // Read is allowed.
    const listRes = await fetch(base + "/deals", { headers: viewerHeaders });
    assert.equal(listRes.status, 200);

    // Create is forbidden.
    const createRes = await fetch(base + "/deals", {
      method: "POST", headers: viewerHeaders, body: JSON.stringify({ title: "nope", value: 1 }),
    });
    assert.equal(createRes.status, 403);
  } finally {
    await stop(server);
  }
});
