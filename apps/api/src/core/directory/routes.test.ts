import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";

// #164 — coverage for the extracted directory router: users, audit, and the guests
// list + per-contact profile (incl. the /guests/:id-before-/guests ordering, spend
// aggregation, and search).

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
const tid = "dir-" + uid();
const owner = `owner-${uid()}@dir.test`;

const listen = async (s: Server): Promise<string> => {
  await new Promise<void>((r) => s.listen(0, r));
  const a = s.address(); if (!a || typeof a === "string") throw new Error("bind");
  return "http://127.0.0.1:" + a.port;
};
const close = (s: Server) => new Promise<void>((res, rej) => s.close((e) => (e ? rej(e) : res())));

let server: Server;
let base: string;
let H: Record<string, string>;
let aliceId = "";

before(async () => {
  await prisma.tenant.create({ data: { id: tid, name: "Dir Co", timezone: "UTC" } });
  await prisma.user.create({ data: { tenantId: tid, fullName: "Owner", email: owner, role: "owner", isActive: true } });
  const alice = await prisma.contact.create({ data: { tenantId: tid, fullName: "Alice Smith", phoneE164: "+9199" + uid().slice(-8), visitCount: 3 } });
  aliceId = alice.id;
  await prisma.contact.create({ data: { tenantId: tid, fullName: "Bob Jones", phoneE164: "+9198" + uid().slice(-8), visitCount: 1 } });
  await prisma.serviceRequest.create({ data: { tenantId: tid, guestId: alice.id, category: "housekeeping", summary: "towels", priority: "normal", source: "whatsapp", status: "open" } });
  await prisma.offerEvent.create({ data: { tenantId: tid, guestId: alice.id, offerType: "upgrade", status: "accepted", revenueInr: 2500, contextJson: "{}" } });
  await prisma.auditLog.create({ data: { tenantId: tid, actorRole: "system", action: "test.event", entityType: "x", entityId: "1", metadata: "{}" } });

  server = buildServer();
  base = await listen(server);
  const r = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tid, email: owner, role: "owner" }),
  });
  const { token } = await r.json() as { token: string };
  H = { authorization: "Bearer " + token };
});

after(async () => {
  await close(server);
  await prisma.offerEvent.deleteMany({ where: { tenantId: tid } });
  await prisma.serviceRequest.deleteMany({ where: { tenantId: tid } });
  await prisma.auditLog.deleteMany({ where: { tenantId: tid } });
  await prisma.contact.deleteMany({ where: { tenantId: tid } });
  await prisma.user.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("GET /users lists tenant users with pagination", async () => {
  const r = await fetch(base + "/users", { headers: H });
  const b = await r.json() as { ok: boolean; items: Array<{ email: string }>; page: { total: number } };
  assert.equal(r.status, 200);
  assert.ok(b.page.total >= 1);
  assert.ok(b.items.some((u) => u.email === owner));
});

test("GET /audit lists the tenant audit log", async () => {
  const r = await fetch(base + "/audit", { headers: H });
  const b = await r.json() as { ok: boolean; items: Array<{ action: string }> };
  assert.equal(r.status, 200);
  assert.ok(b.items.some((a) => a.action === "test.event"));
});

test("GET /guests lists contacts (visitCount desc) with derived fields", async () => {
  const r = await fetch(base + "/guests", { headers: H });
  const b = await r.json() as { ok: boolean; items: Array<{ fullName: string; totalRequests: number }>; page: { total: number } };
  assert.equal(r.status, 200);
  assert.equal(b.page.total, 2);
  assert.equal(b.items[0]!.fullName, "Alice Smith"); // visitCount 3 > 1
  assert.equal(b.items[0]!.totalRequests, 1);
});

test("GET /guests?search filters by name", async () => {
  const r = await fetch(base + "/guests?search=bob", { headers: H });
  const b = await r.json() as { ok: boolean; items: Array<{ fullName: string }> };
  assert.equal(r.status, 200);
  assert.equal(b.items.length, 1);
  assert.equal(b.items[0]!.fullName, "Bob Jones");
});

test("GET /guests/:id returns the profile with spend + requests (matched before the list)", async () => {
  const r = await fetch(base + `/guests/${aliceId}`, { headers: H });
  const b = await r.json() as { ok: boolean; guest: { fullName: string; totalSpendInr: number; serviceRequests: unknown[] } };
  assert.equal(r.status, 200);
  assert.equal(b.guest.fullName, "Alice Smith");
  assert.equal(b.guest.totalSpendInr, 2500);
  assert.equal(b.guest.serviceRequests.length, 1);

  const missing = await fetch(base + `/guests/nope-${uid()}`, { headers: H });
  assert.equal(missing.status, 404);
});

test("directory routes require authentication", async () => {
  for (const p of ["/users", "/audit", "/guests", `/guests/${aliceId}`]) {
    assert.equal((await fetch(base + p)).status, 401, `${p} must 401`);
  }
});
