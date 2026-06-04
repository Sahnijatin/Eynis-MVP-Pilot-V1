import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../server";
import { prisma } from "../db/prisma";
import { createAuthToken, verifyAuthToken } from "./auth";
import { seedDefaultRolesForHotel } from "./rbac";

// Plan A3: the generic `roleKey` is the canonical role identity; the hospitality
// `role` union is a deprecated backward-compat alias.

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

async function seedHotelWithAdmin() {
  const tenantId = "rk-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "RK " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await seedDefaultRolesForHotel(tenantId);
  const adminRole = await prisma.role.findFirst({ where: { tenantId, key: "admin" }, select: { id: true } });
  const email = `admin+${tenantId}@test.local`;
  await prisma.user.create({ data: { tenantId, fullName: "Admin", email, role: "owner", roleId: adminRole!.id, isActive: true } });
  return { tenantId, email };
}

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind failed");
  return "http://127.0.0.1:" + a.port;
};
const close = (server: Server) => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));

after(async () => { await prisma.$disconnect(); });

test("POST /auth/token accepts the generic roleKey and authenticates", async () => {
  const { tenantId, email } = await seedHotelWithAdmin();
  const server = buildServer();
  const base = await listen(server);
  try {
    const tokRes = await fetch(base + "/auth/token", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId, email, roleKey: "admin" }),
    });
    const tok = (await tokRes.json()) as { ok: boolean; token?: string };
    assert.equal(tokRes.status, 200);
    assert.ok(tok.token);

    // The token works and the context exposes the generic roleKey.
    const ctxRes = await fetch(base + "/context", { headers: { authorization: "Bearer " + tok.token } });
    const ctx = (await ctxRes.json()) as { ok: boolean; context?: { roleKey?: string } };
    assert.equal(ctxRes.status, 200);
    assert.equal(ctx.context?.roleKey, "admin");
  } finally { await close(server); }
});

test("POST /auth/token still accepts the legacy hospitality role (backward compat)", async () => {
  const { tenantId, email } = await seedHotelWithAdmin();
  const server = buildServer();
  const base = await listen(server);
  try {
    const tokRes = await fetch(base + "/auth/token", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId, email, role: "owner" }),
    });
    assert.equal(tokRes.status, 200);
    assert.ok((await tokRes.json() as { token?: string }).token);
  } finally { await close(server); }
});

test("verifyAuthToken accepts a roleKey-only (union-free) token", async () => {
  const token = await createAuthToken({ sub: "u1", tenantId: "h1", email: "a@b.com", roleKey: "manager", permissions: ["view_requests"] });
  const claims = await verifyAuthToken(token);
  assert.ok(claims);
  assert.equal(claims?.roleKey, "manager");
  assert.equal(claims?.role, null); // no legacy role emitted
});

test("verifyAuthToken rejects a token carrying no role identity", async () => {
  const token = await createAuthToken({ sub: "u1", tenantId: "h1", email: "a@b.com", permissions: [] });
  assert.equal(await verifyAuthToken(token), null);
});
