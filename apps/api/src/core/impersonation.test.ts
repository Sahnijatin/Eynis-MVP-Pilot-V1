import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../server";
import { prisma } from "../db/prisma";
import { createAuthToken, verifyAuthToken } from "./auth";
import { seedDefaultRolesForHotel } from "./rbac";

// E-6: server-authoritative user impersonation. These tests exercise the API
// contract that the web impersonation UI is built on.

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

async function seedTenantWithUsers() {
  const tenantId = "imp-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "Imp " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await seedDefaultRolesForHotel(tenantId);
  const adminRole = await prisma.role.findFirst({ where: { tenantId, key: "admin" }, select: { id: true } });
  const agentRole = await prisma.role.findFirst({ where: { tenantId, key: "agent" }, select: { id: true } });
  const adminEmail = `admin+${tenantId}@test.local`;
  const agentEmail = `agent+${tenantId}@test.local`;
  const admin = await prisma.user.create({ data: { tenantId, fullName: "Admin", email: adminEmail, role: "owner", roleId: adminRole!.id, isActive: true } });
  const agent = await prisma.user.create({ data: { tenantId, fullName: "Agent Amy", email: agentEmail, role: "housekeeping", roleId: agentRole!.id, isActive: true } });
  return { tenantId, admin, agent, adminEmail, agentEmail };
}

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind failed");
  return "http://127.0.0.1:" + a.port;
};
const close = (server: Server) => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));

const tokenFor = async (base: string, tenantId: string, email: string, roleKey: string): Promise<string> => {
  const r = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId, email, roleKey }),
  });
  return ((await r.json()) as { token: string }).token;
};

after(async () => { await prisma.$disconnect(); });

test("admin can impersonate a real user; token reflects the target + records the impersonator", async () => {
  const { tenantId, agent, adminEmail, agentEmail } = await seedTenantWithUsers();
  const server = buildServer();
  const base = await listen(server);
  try {
    const adminToken = await tokenFor(base, tenantId, adminEmail, "admin");

    const impRes = await fetch(base + "/auth/impersonate", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + adminToken },
      body: JSON.stringify({ targetUserId: agent.id }),
    });
    assert.equal(impRes.status, 200);
    const impData = (await impRes.json()) as { ok: boolean; token: string; target: { email: string; roleKey: string } };
    assert.ok(impData.token);
    assert.equal(impData.target.email, agentEmail);
    assert.equal(impData.target.roleKey, "agent");

    // The impersonation token authenticates as the target, carrying the impersonator.
    const ctxRes = await fetch(base + "/context", { headers: { authorization: "Bearer " + impData.token } });
    const ctx = (await ctxRes.json()) as { context: { roleKey: string; email: string; impersonatorEmail: string } };
    assert.equal(ctx.context.roleKey, "agent");
    assert.equal(ctx.context.email, agentEmail);
    assert.equal(ctx.context.impersonatorEmail, adminEmail);

    // An impersonation session can never start another impersonation (perm stripped → 403).
    const nested = await fetch(base + "/auth/impersonate", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + impData.token },
      body: JSON.stringify({ targetUserId: agent.id }),
    });
    assert.equal(nested.status, 403);

    // Stop is allowed for the impersonated session.
    const stop = await fetch(base + "/auth/impersonate/stop", { method: "POST", headers: { authorization: "Bearer " + impData.token } });
    assert.equal(stop.status, 200);
  } finally { await close(server); }
});

test("a non-admin cannot start impersonation (403)", async () => {
  const { tenantId, admin, agentEmail } = await seedTenantWithUsers();
  const server = buildServer();
  const base = await listen(server);
  try {
    const agentToken = await tokenFor(base, tenantId, agentEmail, "agent");
    const res = await fetch(base + "/auth/impersonate", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + agentToken },
      body: JSON.stringify({ targetUserId: admin.id }),
    });
    assert.equal(res.status, 403);
  } finally { await close(server); }
});

test("impersonation is rejected for self and for cross-tenant targets", async () => {
  const a = await seedTenantWithUsers();
  const b = await seedTenantWithUsers();
  const server = buildServer();
  const base = await listen(server);
  try {
    const adminToken = await tokenFor(base, a.tenantId, a.adminEmail, "admin");

    // Self
    const selfRes = await fetch(base + "/auth/impersonate", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + adminToken },
      body: JSON.stringify({ targetUserId: a.admin.id }),
    });
    assert.equal(selfRes.status, 400);

    // Cross-tenant (user in tenant B)
    const crossRes = await fetch(base + "/auth/impersonate", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + adminToken },
      body: JSON.stringify({ targetUserId: b.agent.id }),
    });
    assert.equal(crossRes.status, 404);
  } finally { await close(server); }
});

test("createAuthToken/verifyAuthToken round-trips impersonator claims", async () => {
  const token = await createAuthToken({
    sub: "u1", tenantId: "h1", email: "agent@b.com", roleKey: "agent", permissions: ["view_requests"],
    impersonatorUserId: "admin1", impersonatorEmail: "admin@b.com",
  });
  const claims = await verifyAuthToken(token);
  assert.ok(claims);
  assert.equal(claims?.impersonatorUserId, "admin1");
  assert.equal(claims?.impersonatorEmail, "admin@b.com");
});
