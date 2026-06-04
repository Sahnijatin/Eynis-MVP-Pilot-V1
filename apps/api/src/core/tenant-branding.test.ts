import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../server";
import { prisma } from "../db/prisma";

// White-label tenant branding endpoints (GET/PUT /tenant/branding).

const uid = () => "brand-hotel-" + Date.now() + "-" + Math.random().toString(16).slice(2);

const createHotel = async (tenantId: string) => {
  await prisma.tenant.create({ data: { id: tenantId, name: "Brand Test " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
};
const createUser = async (tenantId: string, role: "owner" | "housekeeping", email: string) => {
  await prisma.user.create({ data: { tenantId, fullName: "User " + role, email, role, isActive: true } });
};

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind failed");
  return "http://127.0.0.1:" + a.port;
};
const closeS = (server: Server) => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));

const authHeaders = async (base: string, tenantId: string, email: string, role: "owner" | "housekeeping") => {
  const r = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId, email, role }),
  });
  const p = (await r.json()) as { ok: boolean; token?: string };
  assert.equal(p.ok, true);
  return { authorization: "Bearer " + p.token, "content-type": "application/json" };
};

after(async () => { await prisma.$disconnect(); });

test("GET /tenant/branding returns null before any branding is set", async () => {
  const tenantId = uid();
  await createHotel(tenantId);
  await createUser(tenantId, "owner", "owner+" + tenantId + "@test.local");
  const server = buildServer();
  const base = await listen(server);
  try {
    const headers = await authHeaders(base, tenantId, "owner+" + tenantId + "@test.local", "owner");
    const r = await fetch(base + "/tenant/branding", { headers });
    const p = (await r.json()) as { ok: boolean; branding: unknown };
    assert.equal(r.status, 200);
    assert.equal(p.ok, true);
    assert.equal(p.branding, null);
  } finally { await closeS(server); }
});

test("PUT /tenant/branding upserts, validates colors, and persists", async () => {
  const tenantId = uid();
  await createHotel(tenantId);
  await createUser(tenantId, "owner", "owner+" + tenantId + "@test.local");
  const server = buildServer();
  const base = await listen(server);
  try {
    const headers = await authHeaders(base, tenantId, "owner+" + tenantId + "@test.local", "owner");
    const put = await fetch(base + "/tenant/branding", {
      method: "PUT", headers,
      body: JSON.stringify({
        brandName: "  Acme Co  ",            // trimmed
        primaryColor: "#123456",             // valid
        accentColor: "teal",                 // invalid → null
        logoUrl: "https://cdn.acme.com/logo.png",
        hidePoweredBy: true,
      }),
    });
    const p = (await put.json()) as { ok: boolean; branding: Record<string, unknown> };
    assert.equal(put.status, 200);
    assert.equal(p.ok, true);
    assert.equal(p.branding.brandName, "Acme Co");
    assert.equal(p.branding.primaryColor, "#123456");
    assert.equal(p.branding.accentColor, null);
    assert.equal(p.branding.logoUrl, "https://cdn.acme.com/logo.png");
    assert.equal(p.branding.hidePoweredBy, true);

    // Persisted + reflected by a fresh GET.
    const get = await fetch(base + "/tenant/branding", { headers });
    const g = (await get.json()) as { ok: boolean; branding: Record<string, unknown> };
    assert.equal(g.branding.brandName, "Acme Co");
    assert.equal(g.branding.primaryColor, "#123456");
  } finally { await closeS(server); }
});

test("PUT /tenant/branding is forbidden without manage_settings", async () => {
  const tenantId = uid();
  await createHotel(tenantId);
  await createUser(tenantId, "housekeeping", "hk+" + tenantId + "@test.local"); // maps to agent → no manage_settings
  const server = buildServer();
  const base = await listen(server);
  try {
    const headers = await authHeaders(base, tenantId, "hk+" + tenantId + "@test.local", "housekeeping");
    const r = await fetch(base + "/tenant/branding", { method: "PUT", headers, body: JSON.stringify({ brandName: "Nope" }) });
    assert.equal(r.status, 403);
  } finally { await closeS(server); }
});
