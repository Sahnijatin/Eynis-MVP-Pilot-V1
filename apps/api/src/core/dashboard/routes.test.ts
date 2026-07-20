import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";

// #164 — coverage for the extracted dashboard router: the four read-only overview
// aggregations, over a known set of seeded service requests. Locks the extraction
// and adds live-feed coverage the e2e suite lacked.

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
const tid = "dash-" + uid();
const email = `owner-${uid()}@dash.test`;

const listen = async (s: Server): Promise<string> => {
  await new Promise<void>((r) => s.listen(0, r));
  const a = s.address(); if (!a || typeof a === "string") throw new Error("bind");
  return "http://127.0.0.1:" + a.port;
};
const close = (s: Server) => new Promise<void>((res, rej) => s.close((e) => (e ? rej(e) : res())));

let server: Server;
let base: string;
let headers: Record<string, string>;

before(async () => {
  await prisma.tenant.create({ data: { id: tid, name: "Dash Co", timezone: "UTC" } });
  await prisma.user.create({ data: { tenantId: tid, fullName: "Owner", email, role: "owner", isActive: true } });
  const c = await prisma.contact.create({ data: { tenantId: tid, fullName: "Guest A", phoneE164: "+91990000" + uid().slice(-4) } });
  const now = new Date();
  const mk = (over: Record<string, unknown>) => prisma.serviceRequest.create({
    data: {
      tenantId: tid, guestId: c.id, category: "housekeeping", summary: "s", priority: "normal",
      source: "whatsapp", status: "open", ...over,
    },
  });
  // 2 open, 1 escalated (also open-ish, status escalated), 1 resolved today, 1 SLA-breached open.
  await mk({ status: "open" });
  await mk({ status: "open" });
  await mk({ status: "escalated" });
  await mk({ status: "resolved", resolvedAt: now });
  await mk({ status: "open", slaDueAt: new Date(now.getTime() - 60_000) });

  server = buildServer();
  base = await listen(server);
  const r = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tid, email, role: "owner" }),
  });
  const { token } = await r.json() as { token: string };
  headers = { authorization: "Bearer " + token };
});

after(async () => {
  await close(server);
  await prisma.serviceRequest.deleteMany({ where: { tenantId: tid } });
  await prisma.contact.deleteMany({ where: { tenantId: tid } });
  await prisma.user.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("GET /dashboard/overview counts open / resolved-today / escalated / breached", async () => {
  const r = await fetch(base + "/dashboard/overview", { headers });
  const b = await r.json() as { ok: boolean; metrics: Record<string, number> };
  assert.equal(r.status, 200);
  // open = not resolved → 2 open + 1 escalated + 1 breached-open = 4
  assert.equal(b.metrics.openCount, 4);
  assert.equal(b.metrics.resolvedTodayCount, 1);
  assert.equal(b.metrics.escalatedOpenCount, 1);
  assert.equal(b.metrics.slaBreachedOpenCount, 1);
});

test("GET /dashboard/queue-summary buckets the open queue", async () => {
  const r = await fetch(base + "/dashboard/queue-summary", { headers });
  const b = await r.json() as { ok: boolean; totalOpen: number; byStatus: Record<string, number>; byCategory: Record<string, number> };
  assert.equal(r.status, 200);
  assert.equal(b.totalOpen, 4); // only non-resolved
  assert.equal(b.byStatus.open, 3);
  assert.equal(b.byStatus.escalated, 1);
  assert.equal(b.byCategory.housekeeping, 4);
});

test("GET /dashboard/trends returns a per-day created/resolved series", async () => {
  const r = await fetch(base + "/dashboard/trends?days=7", { headers });
  const b = await r.json() as { ok: boolean; days: number; series: Array<{ date: string; created: number; resolved: number }> };
  assert.equal(r.status, 200);
  assert.equal(b.days, 7);
  assert.equal(b.series.length, 7);
  const totalCreated = b.series.reduce((s, p) => s + p.created, 0);
  const totalResolved = b.series.reduce((s, p) => s + p.resolved, 0);
  assert.equal(totalCreated, 5, "all 5 SRs created within the window");
  assert.equal(totalResolved, 1);
});

test("GET /dashboard/live-feed returns open requests with guest/assignee", async () => {
  const r = await fetch(base + "/dashboard/live-feed", { headers });
  const b = await r.json() as { ok: boolean; items: Array<{ status: string; guest: { fullName: string } | null }> };
  assert.equal(r.status, 200);
  assert.equal(b.items.length, 4, "only non-resolved requests");
  assert.ok(b.items.every((i) => i.status !== "resolved"));
  assert.ok(b.items.every((i) => i.guest?.fullName === "Guest A"));
});

test("dashboard routes require authentication", async () => {
  for (const path of ["/dashboard/overview", "/dashboard/queue-summary", "/dashboard/trends", "/dashboard/live-feed"]) {
    const r = await fetch(base + path);
    assert.equal(r.status, 401, `${path} must 401 without a token`);
  }
});
