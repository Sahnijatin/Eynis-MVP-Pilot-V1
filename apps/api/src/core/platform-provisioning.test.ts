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
  const body = await ok.json() as { ok: boolean; items: Array<{ whitelabelTier?: string }>; industries: unknown[]; tiers: unknown[] };
  assert.equal(ok.status, 200);
  assert.equal(body.ok, true);
  assert.ok(Array.isArray(body.items));
  assert.ok(body.industries.length >= 5);
  // E-9: list also carries the tier option set + each tenant's current tier.
  assert.ok(body.tiers.length >= 2);
  if (body.items.length) assert.equal(typeof body.items[0]!.whitelabelTier, "string");
});

test("PATCH /internal/tenants/:id/whitelabel-tier updates tier and audit-logs it (E-9)", async () => {
  const tenantId = await seedTenant("hospitality");

  const r = await fetch(base + `/internal/tenants/${tenantId}/whitelabel-tier`, {
    method: "PATCH", headers: staff, body: JSON.stringify({ tier: "white_label", actor: "jatin@eynis" })
  });
  const body = await r.json() as { ok: boolean; tenant: { whitelabelTier: string } };
  assert.equal(r.status, 200);
  assert.equal(body.tenant.whitelabelTier, "white_label");

  const fresh = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { whitelabelTier: true } });
  assert.equal(fresh?.whitelabelTier, "white_label");

  const log = await prisma.auditLog.findFirst({
    where: { tenantId, action: "tenant.whitelabel_tier_changed" }, orderBy: { createdAt: "desc" }
  });
  assert.ok(log, "an audit row should be written");
  assert.equal(log!.actorRole, "platform_staff");
  const meta = JSON.parse(log!.metadata) as { from: string; to: string; actor: string };
  assert.equal(meta.from, "standard");
  assert.equal(meta.to, "white_label");
});

test("PATCH whitelabel-tier rejects an invalid tier and requires the secret", async () => {
  const tenantId = await seedTenant("hospitality");
  const bad = await fetch(base + `/internal/tenants/${tenantId}/whitelabel-tier`, {
    method: "PATCH", headers: staff, body: JSON.stringify({ tier: "platinum-plus" })
  });
  assert.equal(bad.status, 400);

  const noAuth = await fetch(base + `/internal/tenants/${tenantId}/whitelabel-tier`, {
    method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ tier: "white_label" })
  });
  assert.equal(noAuth.status, 401);

  const fresh = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { whitelabelTier: true } });
  assert.equal(fresh?.whitelabelTier, "standard");
});

test("PATCH whitelabel-tier returns 404 for an unknown tenant", async () => {
  const r = await fetch(base + "/internal/tenants/nope-nope/whitelabel-tier", {
    method: "PATCH", headers: staff, body: JSON.stringify({ tier: "white_label" })
  });
  assert.equal(r.status, 404);
});

test("sending domain: PUT registers it (offline → pending + DNS), GET reads it, audit-logged (E-9)", async () => {
  const tenantId = await seedTenant();

  const noAuth = await fetch(base + `/internal/tenants/${tenantId}/sending-domain`, {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ domain: "mail.acme.com" })
  });
  assert.equal(noAuth.status, 401);

  const put = await fetch(base + `/internal/tenants/${tenantId}/sending-domain`, {
    method: "PUT", headers: staff, body: JSON.stringify({ domain: "Mail.Acme.com", fromLocalPart: "campaigns", fromName: "Acme Co" })
  });
  const pj = await put.json() as { ok: boolean; sendingDomain: { domain: string; status: string; fromLocalPart: string; dnsRecords: unknown[] } };
  assert.equal(put.status, 200);
  assert.equal(pj.sendingDomain.domain, "mail.acme.com"); // lower-cased
  assert.equal(pj.sendingDomain.status, "pending");
  assert.equal(pj.sendingDomain.fromLocalPart, "campaigns");
  assert.ok(pj.sendingDomain.dnsRecords.length >= 3);

  const get = await fetch(base + `/internal/tenants/${tenantId}/sending-domain`, { headers: staff });
  const gj = await get.json() as { ok: boolean; sendingDomain: { domain: string } };
  assert.equal(gj.sendingDomain.domain, "mail.acme.com");

  const log = await prisma.auditLog.findFirst({ where: { tenantId, action: "tenant.sending_domain_set" } });
  assert.ok(log, "a set audit row should exist");
  assert.equal(log!.actorRole, "platform_staff");
});

test("sending domain: PUT rejects an invalid domain / local part", async () => {
  const tenantId = await seedTenant();
  const badDomain = await fetch(base + `/internal/tenants/${tenantId}/sending-domain`, {
    method: "PUT", headers: staff, body: JSON.stringify({ domain: "not a domain" })
  });
  assert.equal(badDomain.status, 400);
  const badLocal = await fetch(base + `/internal/tenants/${tenantId}/sending-domain`, {
    method: "PUT", headers: staff, body: JSON.stringify({ domain: "mail.acme.com", fromLocalPart: "bad part" })
  });
  assert.equal(badLocal.status, 400);
});

test("sending domain: POST verify refreshes status + audit-logs; 404 when unset", async () => {
  const none = await seedTenant();
  const missing = await fetch(base + `/internal/tenants/${none}/sending-domain/verify`, { method: "POST", headers: staff });
  assert.equal(missing.status, 404);

  const tenantId = await seedTenant();
  await fetch(base + `/internal/tenants/${tenantId}/sending-domain`, {
    method: "PUT", headers: staff, body: JSON.stringify({ domain: "mail.acme.com" })
  });
  const verify = await fetch(base + `/internal/tenants/${tenantId}/sending-domain/verify`, { method: "POST", headers: staff });
  const vj = await verify.json() as { ok: boolean; sendingDomain: { status: string } };
  assert.equal(verify.status, 200);
  assert.equal(vj.sendingDomain.status, "pending"); // offline → stays pending
  const log = await prisma.auditLog.findFirst({ where: { tenantId, action: "tenant.sending_domain_verified" } });
  assert.ok(log, "a verify audit row should exist");
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
