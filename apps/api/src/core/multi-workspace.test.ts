import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { randomBytes } from "node:crypto";
import { buildServer } from "../server";
import { prisma } from "../db/prisma";
import { verifyAuthToken } from "./auth";
import { seedDefaultRolesForHotel } from "./rbac";

// Multi-workspace membership: one email can belong to many workspaces, each as a
// separate User row with its own role.

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

async function makeTenant() {
  const tenantId = "mw-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "MW " + tenantId.slice(-4), timezone: "Asia/Kolkata", industry: "hospitality" } });
  await seedDefaultRolesForHotel(tenantId);
  return tenantId;
}
const roleId = async (tenantId: string, key: string) =>
  (await prisma.role.findFirst({ where: { tenantId, key }, select: { id: true } }))!.id;

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind failed");
  return "http://127.0.0.1:" + a.port;
};
const close = (server: Server) => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));

after(async () => { await prisma.$disconnect(); });

test("the same email can hold memberships in multiple tenants; /auth/identify lists them all", async () => {
  const email = `multi+${uid()}@test.local`;
  const tA = await makeTenant();
  const tB = await makeTenant();
  await prisma.user.create({ data: { tenantId: tA, fullName: "Member", email, role: "owner", roleId: await roleId(tA, "admin"), isActive: true } });
  await prisma.user.create({ data: { tenantId: tB, fullName: "Member", email, role: "front_desk", roleId: await roleId(tB, "manager"), isActive: true } });

  const server = buildServer();
  const base = await listen(server);
  try {
    const res = await fetch(base + "/auth/identify?email=" + encodeURIComponent(email));
    const data = (await res.json()) as { ok: boolean; exists: boolean; workspaces: Array<{ tenantId: string; roleKey: string }> };
    assert.equal(res.status, 200);
    assert.equal(data.exists, true);
    assert.equal(data.workspaces.length, 2);
    const ids = data.workspaces.map(w => w.tenantId).sort();
    assert.deepEqual(ids, [tA, tB].sort());

    // A token can be minted for either workspace with the same email.
    const tokRes = await fetch(base + "/auth/token", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: tB, email, roleKey: "manager" }),
    });
    const tok = (await tokRes.json()) as { ok: boolean; token: string };
    assert.equal(tokRes.status, 200);
    const claims = await verifyAuthToken(tok.token);
    assert.equal(claims?.tenantId, tB);
    assert.equal(claims?.roleKey, "manager");
  } finally { await close(server); }
});

test("accepting an invite for an email that already belongs to another workspace adds a membership (no rejection)", async () => {
  const email = `invitee+${uid()}@test.local`;
  const tA = await makeTenant();
  const tC = await makeTenant();
  // Existing membership in tenant A.
  await prisma.user.create({ data: { tenantId: tA, fullName: "Existing", email, role: "owner", roleId: await roleId(tA, "admin"), isActive: true } });
  // Inviter in tenant C.
  const inviter = await prisma.user.create({ data: { tenantId: tC, fullName: "Inviter", email: `inviter+${uid()}@test.local`, role: "owner", roleId: await roleId(tC, "admin"), isActive: true } });
  const token = randomBytes(16).toString("hex");
  await prisma.invitation.create({
    data: { tenantId: tC, email, roleId: await roleId(tC, "manager"), token, expiresAt: new Date(Date.now() + 3600_000), invitedById: inviter.id },
  });

  const server = buildServer();
  const base = await listen(server);
  try {
    const res = await fetch(base + `/team/invitations/${token}/accept`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ fullName: "Cross Member" }),
    });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { ok: boolean; tenantId: string };
    assert.equal(data.ok, true);
    assert.equal(data.tenantId, tC);

    // Both memberships now exist for the same email.
    const count = await prisma.user.count({ where: { email } });
    assert.equal(count, 2);
  } finally { await close(server); }
});
