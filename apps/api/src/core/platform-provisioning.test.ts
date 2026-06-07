import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";

// The internal provisioning console (E-8) is gated by PLATFORM_ADMIN_SECRET. Set it
// BEFORE importing the server so the platform-admin module reads it at request time.
const SECRET = "test-platform-admin-secret-0123456789";
process.env.PLATFORM_ADMIN_SECRET = SECRET;

import { buildServer } from "../server";
import { prisma } from "../db/prisma";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

const listen = async (s: Server): Promise<string> => {
  await new Promise<void>((r) => s.listen(0, r));
  const a = s.address(); if (!a || typeof a === "string") throw new Error("bind");
  return "http://127.0.0.1:" + a.port;
};
const close = (s: Server) => new Promise<void>((res, rej) => s.close((e) => (e ? rej(e) : res())));

const staff = { authorization: "Bearer " + SECRET, "content-type": "application/json" };

async function seedTenant(industry = "hospitality") {
  const tenantId = "prov-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "Acme " + tenantId.slice(-4), timezone: "Asia/Kolkata", industry } });
  return tenantId;
}

let server: Server;
let base: string;
before(async () => { server = buildServer(); base = await listen(server); });
after(async () => { await close(server); await prisma.$disconnect(); });

test("GET /internal/tenants requires the platform-admin secret", async () => {
  const noAuth = await fetch(base + "/internal/tenants");
  assert.equal(noAuth.status, 401);

  const wrong = await fetch(base + "/internal/tenants", { headers: { authorization: "Bearer nope" } });
  assert.equal(wrong.status, 401);

  const ok = await fetch(base + "/internal/tenants", { headers: staff });
  const body = await ok.json() as { ok: boolean; items: unknown[]; industries: unknown[] };
  assert.equal(ok.status, 200);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.items));
  assert.ok(body.industries.length >= 5);
});

test("a tenant JWT cannot reach the internal routes", async () => {
  // A normal tenant bearer is not the platform secret → 401, never tenant-RBAC 403.
  const r = await fetch(base + "/internal/tenants", { headers: { authorization: "Bearer some.tenant.jwt" } });
  assert.equal(r.status, 401);
});

test("PATCH /internal/tenants/:id/industry updates industry and audit-logs it", async () => {
  const tenantId = await seedTenant("hospitality");

  const r = await fetch(base + `/internal/tenants/${tenantId}/industry`, {
    method: "PATCH", headers: staff, body: JSON.stringify({ industry: "healthcare", actor: "jatin@eynis" })
  });
  const body = await r.json() as { ok: boolean; tenant: { id: string; industry: string } };
  assert.equal(r.status, 200);
  assert.equal(body.tenant.industry, "healthcare");

  const fresh = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { industry: true } });
  assert.equal(fresh?.industry, "healthcare");

  const log = await prisma.auditLog.findFirst({
    where: { tenantId, action: "tenant.industry_changed" }, orderBy: { createdAt: "desc" }
  });
  assert.ok(log, "an audit log row should be written");
  assert.equal(log!.actorRole, "platform_staff");
  const meta = JSON.parse(log!.metadata) as { from: string; to: string; actor: string };
  assert.equal(meta.from, "hospitality");
  assert.equal(meta.to, "healthcare");
  assert.equal(meta.actor, "jatin@eynis");
});

test("PATCH rejects an invalid industry", async () => {
  const tenantId = await seedTenant("hospitality");
  const r = await fetch(base + `/internal/tenants/${tenantId}/industry`, {
    method: "PATCH", headers: staff, body: JSON.stringify({ industry: "spaceships" })
  });
  assert.equal(r.status, 400);
  const fresh = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { industry: true } });
  assert.equal(fresh?.industry, "hospitality", "industry must be unchanged on a rejected value");
});

test("PATCH returns 404 for an unknown tenant", async () => {
  const r = await fetch(base + "/internal/tenants/does-not-exist/industry", {
    method: "PATCH", headers: staff, body: JSON.stringify({ industry: "travel" })
  });
  assert.equal(r.status, 404);
});

test("PATCH without the secret is rejected and writes nothing", async () => {
  const tenantId = await seedTenant("hospitality");
  const r = await fetch(base + `/internal/tenants/${tenantId}/industry`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ industry: "travel" })
  });
  assert.equal(r.status, 401);
  const fresh = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { industry: true } });
  assert.equal(fresh?.industry, "hospitality");
});
