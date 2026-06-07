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

test("GET /reports/sources lists every source", async () => {
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
    for (const k of ["service_requests", "deals", "contacts", "companies", "campaign_calls", "sentiment_events", "offer_events"]) {
      assert.ok(data.sources.some((s) => s.key === k), `missing source ${k}`);
    }
  } finally { await close(server); }
});

test("executor sums a metric in grouped offer-events + coerces number filters (E-16 Phase B)", async () => {
  const tenantId = await seedTenant();
  await prisma.offerEvent.createMany({
    data: [
      { tenantId, offerType: "room_upgrade", status: "accepted", revenueInr: 1000, contextJson: "{}" },
      { tenantId, offerType: "room_upgrade", status: "accepted", revenueInr: 500, contextJson: "{}" },
      { tenantId, offerType: "fnb_offer", status: "pending", revenueInr: 0, contextJson: "{}" },
    ],
  });
  const grouped = await runReportDefinition(tenantId, { source: "offer_events", columns: ["offerType", "revenueInr"], groupBy: "offerType" });
  assert.ok(grouped.ok);
  if (grouped.ok) {
    const up = grouped.grouped!.find((g) => g.group === "room_upgrade");
    assert.equal(up?.count, 2);
    assert.equal(up?.sum, 1500); // metric (revenueInr) summed
  }

  // A numeric filter value arrives as a string from the client; the executor must
  // coerce it so Prisma doesn't reject it.
  const filtered = await runReportDefinition(tenantId, { source: "offer_events", columns: ["offerType", "revenueInr"], filters: [{ field: "revenueInr", op: "eq", value: "1000" }] });
  assert.ok(filtered.ok);
  if (filtered.ok) assert.equal(filtered.total, 1);
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

test("export renders csv + a real PDF (₹ labels don't crash the renderer, E-16 Phase B)", async () => {
  const tenantId = await seedTenant();
  await addUser(tenantId, `e+${tenantId}@t.local`, "admin", "owner");
  await prisma.offerEvent.create({ data: { tenantId, offerType: "room_upgrade", status: "accepted", revenueInr: 1000, contextJson: "{}" } });

  const server = buildServer();
  const base = await listen(server);
  try {
    const headers = await authHeader(base, tenantId, `e+${tenantId}@t.local`, "admin");
    // offer_events has a "Revenue (₹)" column label → exercises the PDF sanitizer.
    const save = await fetch(base + "/reports", { method: "POST", headers, body: JSON.stringify({
      name: "Revenue by offer", definition: { source: "offer_events", columns: ["offerType", "revenueInr"], groupBy: "offerType", visualization: "bar" },
    }) });
    const { id } = await save.json() as { id: string };

    const csv = await fetch(base + `/reports/${id}/export?format=csv`, { headers });
    assert.equal(csv.status, 200);
    assert.match(csv.headers.get("content-type") ?? "", /csv/);

    const pdf = await fetch(base + `/reports/${id}/export?format=pdf`, { headers });
    assert.equal(pdf.status, 200);
    assert.equal(pdf.headers.get("content-type"), "application/pdf");
    const bytes = new Uint8Array(await pdf.arrayBuffer());
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-"); // a genuine PDF
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

test("report ACL: per-user + per-role grants widen visibility; owner-only management (E-16 Phase B)", async () => {
  const tenantId = await seedTenant();
  await addUser(tenantId, `owner+${tenantId}@t.local`, "admin", "owner");
  await addUser(tenantId, `mgr+${tenantId}@t.local`, "manager", "front_desk");
  await addUser(tenantId, `sup+${tenantId}@t.local`, "supervisor", "fnb_manager");
  const mgr = await prisma.user.findFirst({ where: { tenantId, email: `mgr+${tenantId}@t.local` }, select: { id: true } });

  const server = buildServer();
  const base = await listen(server);
  try {
    const owner = await authHeader(base, tenantId, `owner+${tenantId}@t.local`, "admin");
    const mgrH = await authHeader(base, tenantId, `mgr+${tenantId}@t.local`, "manager");
    const supH = await authHeader(base, tenantId, `sup+${tenantId}@t.local`, "supervisor");

    const save = await fetch(base + "/reports", { method: "POST", headers: owner, body: JSON.stringify({
      name: "ACL", shared: false, definition: { source: "contacts", columns: ["fullName"] },
    }) });
    const { id } = await save.json() as { id: string };

    // Private → both non-owners blocked.
    assert.equal((await fetch(base + `/reports/${id}`, { headers: mgrH })).status, 404);
    assert.equal((await fetch(base + `/reports/${id}`, { headers: supH })).status, 404);

    // Grant to the manager user specifically + everyone with the supervisor role.
    // Bogus principals (unknown user / unknown type) are silently dropped.
    const put = await fetch(base + `/reports/${id}/shares`, { method: "PUT", headers: owner, body: JSON.stringify({
      shares: [
        { principalType: "user", principalId: mgr!.id },
        { principalType: "role", principalId: "supervisor" },
        { principalType: "user", principalId: "not-a-real-user" },
        { principalType: "bogus", principalId: "x" },
      ],
    }) });
    const putData = await put.json() as { ok: boolean; shares: unknown[] };
    assert.equal(put.status, 200);
    assert.equal(putData.shares.length, 2); // only the two valid grants persist

    // Manager (named grant) can open + run + export, and sees it listed as not-owned.
    assert.equal((await fetch(base + `/reports/${id}`, { headers: mgrH })).status, 200);
    assert.equal((await fetch(base + `/reports/${id}/run`, { headers: mgrH })).status, 200);
    assert.equal((await fetch(base + `/reports/${id}/export?format=csv`, { headers: mgrH })).status, 200);
    const mgrList = await (await fetch(base + "/reports", { headers: mgrH })).json() as { items: Array<{ id: string; isOwner: boolean }> };
    assert.ok(mgrList.items.some((r) => r.id === id && !r.isOwner));

    // Supervisor sees it through the role grant.
    assert.equal((await fetch(base + `/reports/${id}`, { headers: supH })).status, 200);

    // Non-owner can neither inspect nor change the grant set.
    assert.equal((await fetch(base + `/reports/${id}/shares`, { headers: mgrH })).status, 403);
    assert.equal((await fetch(base + `/reports/${id}/shares`, { method: "PUT", headers: mgrH, body: JSON.stringify({ shares: [] }) })).status, 403);

    // Owner's share view lists pickable members (excluding themselves) + roles.
    const view = await (await fetch(base + `/reports/${id}/shares`, { headers: owner })).json() as { ok: boolean; shares: unknown[]; users: Array<{ id: string }>; roles: Array<{ key: string }> };
    assert.ok(view.ok);
    assert.equal(view.shares.length, 2);
    assert.ok(view.users.some((u) => u.id === mgr!.id));
    assert.equal(view.users.some((u) => u.id === mgr!.id) && view.roles.length >= 1, true);

    // Owner revokes everything → access closes again for both grantees.
    await fetch(base + `/reports/${id}/shares`, { method: "PUT", headers: owner, body: JSON.stringify({ shares: [] }) });
    assert.equal((await fetch(base + `/reports/${id}`, { headers: mgrH })).status, 404);
    assert.equal((await fetch(base + `/reports/${id}`, { headers: supH })).status, 404);
  } finally { await close(server); }
});
