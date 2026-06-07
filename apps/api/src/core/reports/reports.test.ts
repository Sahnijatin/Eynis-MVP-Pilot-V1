import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";
import { seedDefaultRolesForHotel } from "../rbac";
import { runReportDefinition, REPORT_SOURCES } from "./reports";

// E-16 custom report builder: executor (tenant-scoped, allow-listed columns,
// group-by) + the saved-report endpoints (RBAC, ownership/visibility).

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

const listen = async (s: Server): Promise<string> => {
  await new Promise<void>((r) => s.listen(0, r));
  const a = s.address(); if (!a || typeof a === "string") throw new Error("bind");
  return "http://127.0.0.1:" + a.port;
};
const close = (s: Server) => new Promise<void>((res, rej) => s.close((e) => (e ? rej(e) : res())));

async function seedTenant() {
  const tenantId = "rep-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "R " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await seedDefaultRolesForHotel(tenantId);
  return tenantId;
}

async function addContact(tenantId: string) {
  const c = await prisma.contact.create({ data: { tenantId, fullName: "G", phoneE164: `+91${Date.now()}${Math.floor(Math.random() * 1000)}` } });
  return c.id;
}

async function addUser(tenantId: string, email: string, roleKey: string, legacyRole: string) {
  const role = await prisma.role.findFirst({ where: { tenantId, key: roleKey }, select: { id: true } });
  await prisma.user.create({ data: { tenantId, fullName: "U", email, role: legacyRole, roleId: role!.id, isActive: true } });
}

const authHeader = async (base: string, tenantId: string, email: string, roleKey: string) => {
  const r = await fetch(base + "/auth/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId, email, roleKey }) });
  return { authorization: "Bearer " + (await r.json() as { token: string }).token, "content-type": "application/json" };
};

after(async () => { await prisma.$disconnect(); });

test("executor groups + filters service requests, tenant-scoped, allow-listed (E-16)", async () => {
  const tenantId = await seedTenant();
  const other = await seedTenant();
  const g = await addContact(tenantId);
  const gOther = await addContact(other);
  // Tenant rows.
  await prisma.serviceRequest.createMany({
    data: [
      { tenantId, guestId: g, category: "housekeeping", status: "open", summary: "towels" },
      { tenantId, guestId: g, category: "housekeeping", status: "resolved", summary: "water" },
      { tenantId, guestId: g, category: "maintenance", status: "open", summary: "ac" },
    ],
  });
  // A row in another tenant must never appear.
  await prisma.serviceRequest.create({ data: { tenantId: other, guestId: gOther, category: "housekeeping", status: "open", summary: "leak" } });

  // Grouped by category → counts, tenant-scoped.
  const grouped = await runReportDefinition(tenantId, { source: "service_requests", columns: ["category", "status"], groupBy: "category" });
  assert.ok(grouped.ok);
  if (grouped.ok) {
    assert.equal(grouped.grouped!.find((g) => g.group === "housekeeping")?.count, 2);
    assert.equal(grouped.grouped!.find((g) => g.group === "maintenance")?.count, 1);
  }

  // Ungrouped with a filter → only matching rows.
  const rows = await runReportDefinition(tenantId, { source: "service_requests", columns: ["category", "status", "summary"], filters: [{ field: "status", op: "eq", value: "open" }] });
  assert.ok(rows.ok);
  if (rows.ok) {
    assert.equal(rows.total, 2);
    assert.ok(rows.rows.every((r) => r.status === "open"));
  }
});

test("executor rejects unknown source / columns / fields", async () => {
  const tenantId = await seedTenant();
  assert.equal((await runReportDefinition(tenantId, { source: "secrets", columns: ["x"] })).ok, false);
  assert.equal((await runReportDefinition(tenantId, { source: "deals", columns: ["password"] })).ok, false);
  assert.equal((await runReportDefinition(tenantId, { source: "deals", columns: ["title"], groupBy: "evil" })).ok, false);
});

test("GET /reports/sources lists the Phase-A sources", async () => {
  const tenantId = await seedTenant();
  await addUser(tenantId, `a+${tenantId}@t.local`, "admin", "owner");
  const server = buildServer();
  const base = await listen(server);
  try {
    const headers = await authHeader(base, tenantId, `a+${tenantId}@t.local`, "admin");
    const res = await fetch(base + "/reports/sources", { headers });
    const data = await res.json() as { ok: boolean; sources: Array<{ key: string }> };
    assert.equal(res.status, 200);
    assert.equal(data.sources.length, REPORT_SOURCES.length);
    assert.ok(data.sources.some((s) => s.key === "service_requests"));
  } finally { await close(server); }
});

test("save → list → run a report; module gated by view_reports", async () => {
  const tenantId = await seedTenant();
  await addUser(tenantId, `admin+${tenantId}@t.local`, "admin", "owner");
  await addUser(tenantId, `agent+${tenantId}@t.local`, "agent", "housekeeping");
  const gid = await addContact(tenantId);
  await prisma.serviceRequest.create({ data: { tenantId, guestId: gid, category: "housekeeping", status: "open", summary: "x" } });

  const server = buildServer();
  const base = await listen(server);
  try {
    const admin = await authHeader(base, tenantId, `admin+${tenantId}@t.local`, "admin");

    const save = await fetch(base + "/reports", { method: "POST", headers: admin, body: JSON.stringify({
      name: "Open by category", definition: { source: "service_requests", columns: ["category", "status"], groupBy: "category" },
    }) });
    const saved = await save.json() as { ok: boolean; id: string };
    assert.equal(save.status, 201);
    assert.ok(saved.id);

    const list = await fetch(base + "/reports", { headers: admin });
    const listed = await list.json() as { items: Array<{ id: string; isOwner: boolean }> };
    assert.ok(listed.items.some((r) => r.id === saved.id && r.isOwner));

    const run = await fetch(base + `/reports/${saved.id}/run`, { headers: admin });
    const ran = await run.json() as { ok: boolean; grouped: Array<{ group: string; count: number }> };
    assert.equal(run.status, 200);
    assert.equal(ran.grouped.find((g) => g.group === "housekeeping")?.count, 1);

    // Agent lacks view_reports → the module is closed to them.
    const agent = await authHeader(base, tenantId, `agent+${tenantId}@t.local`, "agent");
    const denied = await fetch(base + "/reports", { headers: agent });
    assert.equal(denied.status, 403);
  } finally { await close(server); }
});

test("private reports are invisible to others; only the creator can edit/delete", async () => {
  const tenantId = await seedTenant();
  await addUser(tenantId, `owner+${tenantId}@t.local`, "admin", "owner");
  await addUser(tenantId, `other+${tenantId}@t.local`, "manager", "front_desk");

  const server = buildServer();
  const base = await listen(server);
  try {
    const owner = await authHeader(base, tenantId, `owner+${tenantId}@t.local`, "admin");
    const other = await authHeader(base, tenantId, `other+${tenantId}@t.local`, "manager");

    const save = await fetch(base + "/reports", { method: "POST", headers: owner, body: JSON.stringify({
      name: "Private", shared: false, definition: { source: "contacts", columns: ["fullName"] },
    }) });
    const { id } = await save.json() as { id: string };

    // Other user can't see or open a private report.
    const list = await fetch(base + "/reports", { headers: other });
    const listed = await list.json() as { items: Array<{ id: string }> };
    assert.equal(listed.items.some((r) => r.id === id), false);
    assert.equal((await fetch(base + `/reports/${id}`, { headers: other })).status, 404);

    // Non-owner can't edit or delete (even once shared).
    await fetch(base + `/reports/${id}`, { method: "PUT", headers: owner, body: JSON.stringify({ shared: true }) });
    const visible = await fetch(base + `/reports/${id}`, { headers: other });
    assert.equal(visible.status, 200); // now shared → readable
    assert.equal((await fetch(base + `/reports/${id}`, { method: "PUT", headers: other, body: JSON.stringify({ name: "hijack" }) })).status, 403);
    assert.equal((await fetch(base + `/reports/${id}`, { method: "DELETE", headers: other })).status, 403);

    // Owner can delete.
    assert.equal((await fetch(base + `/reports/${id}`, { method: "DELETE", headers: owner })).status, 200);
  } finally { await close(server); }
});
