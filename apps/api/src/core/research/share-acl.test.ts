import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";

// Per-run share ACL (RS-3, Unit B). A research run is private to its creator by
// default; it becomes visible to a teammate only when shared tenant-wide, granted
// to them explicitly, or when the teammate holds manage_research (admin/manager
// oversight). Sharing is managed by the creator only. These tests drive the
// behaviour through the HTTP API against a real Postgres DB (no mocking).

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

const createHotel = async (tenantId: string) => {
  await prisma.tenant.create({ data: { id: tenantId, name: "RS " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId, plan: "growth", maxSeats: 25 } });
};
// owner → admin (has manage_research); housekeeping → agent (view+run, no manage).
const createUser = async (tenantId: string, role: string, email: string): Promise<string> => {
  const u = await prisma.user.create({ data: { tenantId, fullName: "U " + role, email, role, isActive: true } });
  return u.id;
};
const RESULT_JSON = JSON.stringify({
  sections: [{ id: "s1", title: "Overview", content: "Prose.", table: null, score: null }],
  score: null, sources: [], usage: { provider: "claude", llmCalls: 0, usedAI: false, sourcesFetched: 0 },
});
const createRun = async (tenantId: string, createdById: string, extra: Record<string, unknown> = {}) =>
  prisma.researchRun.create({
    data: { tenantId, templateName: "Brief", templateSnapshot: "{}", inputsJson: "{}", status: "ready", progress: 100, resultJson: RESULT_JSON, createdById, ...extra },
    select: { id: true },
  });

async function startServer(): Promise<{ server: Server; base: string }> {
  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bind failed");
  return { server, base: "http://127.0.0.1:" + addr.port };
}
const stop = (server: Server) => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
const authHeaders = async (base: string, tenantId: string, email: string, role: string) => {
  const r = await fetch(base + "/auth/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId, email, role }) });
  const p = (await r.json()) as { token?: string };
  if (!p.token) throw new Error("no token");
  return { authorization: "Bearer " + p.token, "content-type": "application/json" };
};
after(async () => { await prisma.$disconnect(); });

test("a run is private to its creator by default; a teammate cannot see it", async () => {
  const tenantId = "rs-" + uid();
  await createHotel(tenantId);
  const ownerEmail = `creator+${tenantId}@test.local`;
  const otherEmail = `other+${tenantId}@test.local`;
  const ownerId = await createUser(tenantId, "housekeeping", ownerEmail); // agent
  await createUser(tenantId, "housekeeping", otherEmail); // agent
  const { server, base } = await startServer();
  try {
    const owner = await authHeaders(base, tenantId, ownerEmail, "housekeeping");
    const other = await authHeaders(base, tenantId, otherEmail, "housekeeping");
    const { id } = await createRun(tenantId, ownerId);

    // Creator sees it (detail + list); teammate does not.
    assert.equal((await fetch(base + `/research/runs/${id}`, { headers: owner })).status, 200);
    assert.equal((await fetch(base + `/research/runs/${id}`, { headers: other })).status, 404);
    const ownerList = (await (await fetch(base + "/research/runs", { headers: owner })).json()) as any;
    assert.ok(ownerList.items.some((r: any) => r.id === id));
    const otherList = (await (await fetch(base + "/research/runs", { headers: other })).json()) as any;
    assert.ok(!otherList.items.some((r: any) => r.id === id));
  } finally { await stop(server); }
});

test("tenant-wide shared makes a run visible to the whole team", async () => {
  const tenantId = "rs-" + uid();
  await createHotel(tenantId);
  const ownerEmail = `creator+${tenantId}@test.local`;
  const otherEmail = `other+${tenantId}@test.local`;
  const ownerId = await createUser(tenantId, "housekeeping", ownerEmail);
  await createUser(tenantId, "housekeeping", otherEmail);
  const { server, base } = await startServer();
  try {
    const owner = await authHeaders(base, tenantId, ownerEmail, "housekeeping");
    const other = await authHeaders(base, tenantId, otherEmail, "housekeeping");
    const { id } = await createRun(tenantId, ownerId);

    // Flip tenant-wide visibility on via the creator-only shares endpoint.
    const put = await fetch(base + `/research/runs/${id}/shares`, { method: "PUT", headers: owner, body: JSON.stringify({ shared: true, shares: [] }) });
    assert.equal(put.status, 200);
    assert.equal((await fetch(base + `/research/runs/${id}`, { headers: other })).status, 200);
  } finally { await stop(server); }
});

test("an explicit user grant makes a run visible to that user only", async () => {
  const tenantId = "rs-" + uid();
  await createHotel(tenantId);
  const ownerEmail = `creator+${tenantId}@test.local`;
  const grantedEmail = `granted+${tenantId}@test.local`;
  const strangerEmail = `stranger+${tenantId}@test.local`;
  const ownerId = await createUser(tenantId, "housekeeping", ownerEmail);
  const grantedId = await createUser(tenantId, "housekeeping", grantedEmail);
  await createUser(tenantId, "housekeeping", strangerEmail);
  const { server, base } = await startServer();
  try {
    const owner = await authHeaders(base, tenantId, ownerEmail, "housekeeping");
    const granted = await authHeaders(base, tenantId, grantedEmail, "housekeeping");
    const stranger = await authHeaders(base, tenantId, strangerEmail, "housekeeping");
    const { id } = await createRun(tenantId, ownerId);

    const put = await fetch(base + `/research/runs/${id}/shares`, { method: "PUT", headers: owner, body: JSON.stringify({ shares: [{ principalType: "user", principalId: grantedId }] }) });
    assert.equal(put.status, 200);
    assert.equal((await fetch(base + `/research/runs/${id}`, { headers: granted })).status, 200);
    assert.equal((await fetch(base + `/research/runs/${id}`, { headers: stranger })).status, 404);

    // Export follows the same ACL: granted can export, stranger cannot.
    assert.equal((await fetch(base + `/research/runs/${id}/export?format=csv`, { headers: granted })).status, 200);
    assert.equal((await fetch(base + `/research/runs/${id}/export?format=csv`, { headers: stranger })).status, 404);
  } finally { await stop(server); }
});

test("a manager (manage_research) sees other users' private runs", async () => {
  const tenantId = "rs-" + uid();
  await createHotel(tenantId);
  const agentEmail = `agent+${tenantId}@test.local`;
  const adminEmail = `admin+${tenantId}@test.local`;
  const agentId = await createUser(tenantId, "housekeeping", agentEmail); // agent: no manage_research
  await createUser(tenantId, "owner", adminEmail); // admin: has manage_research
  const { server, base } = await startServer();
  try {
    const admin = await authHeaders(base, tenantId, adminEmail, "owner");
    const { id } = await createRun(tenantId, agentId);
    assert.equal((await fetch(base + `/research/runs/${id}`, { headers: admin })).status, 200);
    const list = (await (await fetch(base + "/research/runs", { headers: admin })).json()) as any;
    assert.ok(list.items.some((r: any) => r.id === id));
  } finally { await stop(server); }
});

test("only the creator can manage a run's sharing", async () => {
  const tenantId = "rs-" + uid();
  await createHotel(tenantId);
  const ownerEmail = `creator+${tenantId}@test.local`;
  const otherEmail = `other+${tenantId}@test.local`;
  const ownerId = await createUser(tenantId, "housekeeping", ownerEmail);
  await createUser(tenantId, "housekeeping", otherEmail);
  const { server, base } = await startServer();
  try {
    const owner = await authHeaders(base, tenantId, ownerEmail, "housekeeping");
    const other = await authHeaders(base, tenantId, otherEmail, "housekeeping");
    const { id } = await createRun(tenantId, ownerId);

    assert.equal((await fetch(base + `/research/runs/${id}/shares`, { headers: owner })).status, 200);
    assert.equal((await fetch(base + `/research/runs/${id}/shares`, { headers: other })).status, 403);
    const put = await fetch(base + `/research/runs/${id}/shares`, { method: "PUT", headers: other, body: JSON.stringify({ shared: true, shares: [] }) });
    assert.equal(put.status, 403);
  } finally { await stop(server); }
});

test("tenant isolation: a run cannot be viewed or shared across tenants", async () => {
  const tenantA = "rs-" + uid();
  const tenantB = "rs-" + uid();
  await createHotel(tenantA); await createHotel(tenantB);
  const emailA = `owner+${tenantA}@test.local`;
  const emailB = `owner+${tenantB}@test.local`;
  const ownerA = await createUser(tenantA, "owner", emailA);
  await createUser(tenantB, "owner", emailB);
  const { server, base } = await startServer();
  try {
    const hB = await authHeaders(base, tenantB, emailB, "owner");
    const { id } = await createRun(tenantA, ownerA);
    // Even an admin in tenant B (manage_research) cannot reach tenant A's run.
    assert.equal((await fetch(base + `/research/runs/${id}`, { headers: hB })).status, 404);
    assert.equal((await fetch(base + `/research/runs/${id}/shares`, { headers: hB })).status, 404);
  } finally { await stop(server); }
});
