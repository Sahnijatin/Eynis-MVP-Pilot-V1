import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../server";
import { prisma } from "../db/prisma";
import { seedDefaultRolesForHotel } from "./rbac";

// A7 — white-label routing: public host/slug → tenant resolution, and the
// admin endpoint to set a tenant's slug + custom domain.

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

const listen = async (s: Server): Promise<string> => {
  await new Promise<void>((r) => s.listen(0, r));
  const a = s.address(); if (!a || typeof a === "string") throw new Error("bind");
  return "http://127.0.0.1:" + a.port;
};
const close = (s: Server) => new Promise<void>((res, rej) => s.close((e) => (e ? rej(e) : res())));

async function seedAdmin() {
  const tenantId = "dom-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "Tempus " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await seedDefaultRolesForHotel(tenantId);
  const adminRole = await prisma.role.findFirst({ where: { tenantId, key: "admin" }, select: { id: true } });
  const email = `admin+${tenantId}@test.local`;
  await prisma.user.create({ data: { tenantId, fullName: "A", email, role: "owner", roleId: adminRole!.id, isActive: true } });
  return { tenantId, email };
}
const authHeader = async (base: string, tenantId: string, email: string) => {
  const r = await fetch(base + "/auth/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId, email, roleKey: "admin" }) });
  return { authorization: "Bearer " + (await r.json() as { token: string }).token, "content-type": "application/json" };
};

after(async () => { await prisma.$disconnect(); });

test("PUT /tenant/domains sets the self-serve subdomain; resolve maps it back", async () => {
  const { tenantId, email } = await seedAdmin();
  const server = buildServer();
  const base = await listen(server);
  try {
    const headers = await authHeader(base, tenantId, email);
    const slug = "tempus" + uid();

    const put = await fetch(base + "/tenant/domains", { method: "PUT", headers, body: JSON.stringify({ slug }) });
    const pj = await put.json() as { ok: boolean; slug: string };
    assert.equal(put.status, 200);
    assert.equal(pj.slug, slug);

    // Resolve by <slug>.eynis.com subdomain.
    const bySub = await fetch(base + `/tenant/resolve?host=${slug}.eynis.com`);
    const bs = await bySub.json() as { found: boolean; tenantId: string };
    assert.equal(bs.found, true);
    assert.equal(bs.tenantId, tenantId);
  } finally { await close(server); }
});

test("PUT /tenant/domains rejects a customer-set custom domain (provider-managed, E-10)", async () => {
  const { tenantId, email } = await seedAdmin();
  const server = buildServer();
  const base = await listen(server);
  try {
    const headers = await authHeader(base, tenantId, email);
    const put = await fetch(base + "/tenant/domains", { method: "PUT", headers, body: JSON.stringify({ customDomain: `app.${uid()}.com` }) });
    assert.equal(put.status, 403);

    // Nothing was persisted — custom domains are provisioned by staff, not here.
    const fresh = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { customDomain: true } });
    assert.equal(fresh?.customDomain, null);
  } finally { await close(server); }
});

test("GET /tenant/resolve maps a provider-set custom domain back to its tenant", async () => {
  const { tenantId } = await seedAdmin();
  const server = buildServer();
  const base = await listen(server);
  try {
    // Custom domain is set by staff (here, directly) — not via the customer endpoint.
    const customDomain = `app.${uid()}.com`;
    await prisma.tenant.update({ where: { id: tenantId }, data: { customDomain } });

    const byHost = await fetch(base + `/tenant/resolve?host=${customDomain}`);
    const bh = await byHost.json() as { found: boolean; tenantId: string };
    assert.equal(bh.found, true);
    assert.equal(bh.tenantId, tenantId);
  } finally { await close(server); }
});

test("POST /tenant/domains/request files an audit entry for staff to action", async () => {
  const { tenantId, email } = await seedAdmin();
  const server = buildServer();
  const base = await listen(server);
  try {
    const headers = await authHeader(base, tenantId, email);
    const desiredDomain = `app.${uid()}.com`;
    const r = await fetch(base + "/tenant/domains/request", { method: "POST", headers, body: JSON.stringify({ desiredDomain }) });
    assert.equal(r.status, 200);

    const log = await prisma.auditLog.findFirst({ where: { tenantId, action: "tenant.custom_domain_requested" }, orderBy: { createdAt: "desc" } });
    assert.ok(log, "a request audit row should be written");
    const meta = JSON.parse(log!.metadata) as { desiredDomain: string };
    assert.equal(meta.desiredDomain, desiredDomain);
  } finally { await close(server); }
});

test("GET /tenant/resolve returns found:false for platform hosts and unknown hosts", async () => {
  const server = buildServer();
  const base = await listen(server);
  try {
    for (const host of ["eynis.com", "demo.eynis.com", "localhost", "nobody.example.com"]) {
      const r = await fetch(base + `/tenant/resolve?host=${host}`);
      const j = await r.json() as { ok: boolean; found: boolean };
      assert.equal(j.ok, true);
      assert.equal(j.found, false, `${host} should not resolve`);
    }
  } finally { await close(server); }
});

test("PUT /tenant/domains rejects a bad slug", async () => {
  const { tenantId, email } = await seedAdmin();
  const server = buildServer();
  const base = await listen(server);
  try {
    const headers = await authHeader(base, tenantId, email);
    const badSlug = await fetch(base + "/tenant/domains", { method: "PUT", headers, body: JSON.stringify({ slug: "Bad Slug!" }) });
    assert.equal(badSlug.status, 400);
  } finally { await close(server); }
});

test("PUT /tenant/domains returns 409 when a slug is already taken", async () => {
  const a = await seedAdmin();
  const b = await seedAdmin();
  const server = buildServer();
  const base = await listen(server);
  try {
    const slug = "shared" + uid();
    const ha = await authHeader(base, a.tenantId, a.email);
    const hb = await authHeader(base, b.tenantId, b.email);
    const first = await fetch(base + "/tenant/domains", { method: "PUT", headers: ha, body: JSON.stringify({ slug }) });
    assert.equal(first.status, 200);
    const second = await fetch(base + "/tenant/domains", { method: "PUT", headers: hb, body: JSON.stringify({ slug }) });
    assert.equal(second.status, 409);
  } finally { await close(server); }
});
