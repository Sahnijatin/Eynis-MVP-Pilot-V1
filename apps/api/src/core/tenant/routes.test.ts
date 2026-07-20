import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";

// #164 — coverage for the extracted tenant/self settings router: context, own
// profile + bell prefs, the notification feed, and tenant profile/branding/domains.

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
const tid = "tm-" + uid();
const owner = `owner-${uid()}@tm.test`;

const listen = async (s: Server): Promise<string> => {
  await new Promise<void>((r) => s.listen(0, r));
  const a = s.address(); if (!a || typeof a === "string") throw new Error("bind");
  return "http://127.0.0.1:" + a.port;
};
const close = (s: Server) => new Promise<void>((res, rej) => s.close((e) => (e ? rej(e) : res())));

let server: Server;
let base: string;
let H: Record<string, string>;

before(async () => {
  await prisma.tenant.create({ data: { id: tid, name: "TM Co", timezone: "UTC" } });
  await prisma.user.create({ data: { tenantId: tid, fullName: "Owner", email: owner, role: "owner", isActive: true } });
  const c = await prisma.contact.create({ data: { tenantId: tid, fullName: "G", phoneE164: "+9199" + uid().slice(-8) } });
  // A breached, escalated SR so /notifications has an alert to surface.
  await prisma.serviceRequest.create({ data: { tenantId: tid, guestId: c.id, category: "housekeeping", summary: "overdue", priority: "high", source: "whatsapp", status: "escalated", slaBreachedAt: new Date() } });
  server = buildServer();
  base = await listen(server);
  const r = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tid, email: owner, role: "owner" }),
  });
  const { token } = await r.json() as { token: string };
  H = { authorization: "Bearer " + token, "content-type": "application/json" };
});

after(async () => {
  await close(server);
  await prisma.serviceRequest.deleteMany({ where: { tenantId: tid } });
  await prisma.tenantBranding.deleteMany({ where: { tenantId: tid } });
  await prisma.auditLog.deleteMany({ where: { tenantId: tid } });
  await prisma.contact.deleteMany({ where: { tenantId: tid } });
  await prisma.user.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("GET /context returns the caller's context", async () => {
  const r = await fetch(base + "/context", { headers: H });
  const b = await r.json() as { ok: boolean; context: { tenantId: string } };
  assert.equal(r.status, 200);
  assert.equal(b.context.tenantId, tid);
});

test("PATCH /me updates the display name and rejects blanks", async () => {
  const bad = await fetch(base + "/me", { method: "PATCH", headers: H, body: JSON.stringify({ fullName: "  " }) });
  assert.equal(bad.status, 400);
  const ok = await fetch(base + "/me", { method: "PATCH", headers: H, body: JSON.stringify({ fullName: "New Name" }) });
  const b = await ok.json() as { ok: boolean; user: { fullName: string } };
  assert.equal(ok.status, 200);
  assert.equal(b.user.fullName, "New Name");
});

test("GET/PATCH /me/notifications default to all-on and persist toggles", async () => {
  const g = await fetch(base + "/me/notifications", { headers: H });
  const gb = await g.json() as { prefs: { escalations: boolean; inventory: boolean; quotes: boolean } };
  assert.deepEqual(gb.prefs, { escalations: true, inventory: true, quotes: true });

  const p = await fetch(base + "/me/notifications", { method: "PATCH", headers: H, body: JSON.stringify({ inventory: false }) });
  const pb = await p.json() as { prefs: { inventory: boolean; escalations: boolean } };
  assert.equal(pb.prefs.inventory, false);
  assert.equal(pb.prefs.escalations, true, "unspecified prefs are preserved");
});

test("GET/PATCH /tenant/profile reads and updates property details", async () => {
  const g = await fetch(base + "/tenant/profile", { headers: H });
  const gb = await g.json() as { profile: { name: string } };
  assert.equal(gb.profile.name, "TM Co");

  const bad = await fetch(base + "/tenant/profile", { method: "PATCH", headers: H, body: JSON.stringify({ name: "" }) });
  assert.equal(bad.status, 400);

  const p = await fetch(base + "/tenant/profile", { method: "PATCH", headers: H, body: JSON.stringify({ address: "1 Main St" }) });
  const pb = await p.json() as { profile: { address: string; name: string } };
  assert.equal(pb.profile.address, "1 Main St");
  assert.equal(pb.profile.name, "TM Co", "unspecified fields unchanged");
});

test("GET/PUT /tenant/branding sanitises and upserts", async () => {
  const g = await fetch(base + "/tenant/branding", { headers: H });
  const gb = await g.json() as { branding: unknown; whitelabelTier: string };
  assert.equal(gb.branding, null);
  assert.equal(gb.whitelabelTier, "standard");

  const p = await fetch(base + "/tenant/branding", { method: "PUT", headers: H, body: JSON.stringify({ brandName: "Acme", primaryColor: "#ffee00", accentColor: "not-a-color" }) });
  const pb = await p.json() as { branding: { brandName: string; primaryColor: string; accentColor: string | null } };
  assert.equal(p.status, 200);
  assert.equal(pb.branding.brandName, "Acme");
  assert.equal(pb.branding.primaryColor, "#ffee00");
  assert.equal(pb.branding.accentColor, null, "invalid colour is dropped to null");
});

test("GET/PUT /tenant/domains sets the slug but rejects self-set custom domains", async () => {
  const slug = "acme" + uid().slice(-5);
  const ok = await fetch(base + "/tenant/domains", { method: "PUT", headers: H, body: JSON.stringify({ slug }) });
  const okb = await ok.json() as { ok: boolean; slug: string };
  assert.equal(ok.status, 200);
  assert.equal(okb.slug, slug);

  const custom = await fetch(base + "/tenant/domains", { method: "PUT", headers: H, body: JSON.stringify({ customDomain: "app.acme.com" }) });
  assert.equal(custom.status, 403);

  const badSlug = await fetch(base + "/tenant/domains", { method: "PUT", headers: H, body: JSON.stringify({ slug: "Bad Slug!" }) });
  assert.equal(badSlug.status, 400);
});

test("POST /tenant/domains/request audit-logs the ask", async () => {
  const r = await fetch(base + "/tenant/domains/request", { method: "POST", headers: H, body: JSON.stringify({ desiredDomain: "APP.acme.com", note: "please" }) });
  assert.equal(r.status, 200);
  const log = await prisma.auditLog.findFirst({ where: { tenantId: tid, action: "tenant.custom_domain_requested" }, orderBy: { createdAt: "desc" } });
  assert.ok(log);
  const meta = JSON.parse(log!.metadata) as { desiredDomain: string };
  assert.equal(meta.desiredDomain, "app.acme.com", "domain is lower-cased");
});

test("GET /notifications surfaces the breached/escalated request as an alert", async () => {
  const r = await fetch(base + "/notifications", { headers: H });
  const b = await r.json() as { ok: boolean; items: Array<{ type: string; title: string }> };
  assert.equal(r.status, 200);
  assert.ok(b.items.some((i) => i.type === "alert" && i.title.startsWith("Overdue")));
});

test("tenant/me routes require authentication", async () => {
  for (const p of ["/context", "/me/notifications", "/tenant/profile", "/tenant/branding", "/tenant/domains", "/notifications"]) {
    assert.equal((await fetch(base + p)).status, 401, `${p} must 401`);
  }
});
