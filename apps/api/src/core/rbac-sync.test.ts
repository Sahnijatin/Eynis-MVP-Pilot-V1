import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../server";
import { prisma } from "../db/prisma";
import { seedDefaultRolesForHotel, syncSystemRolePermissions, parsePermissions } from "./rbac";

// Regression: a tenant seeded BEFORE a permission was added (e.g. the CRM
// `view_crm`/`manage_crm`) was left on a stale role snapshot, so even an Admin
// got "Insufficient permissions" creating a contact/company. System-role
// permissions must track the code defaults; syncSystemRolePermissions() back-fills.

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

const listen = async (server: Server): Promise<string> => {
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  if (!a || typeof a === "string") throw new Error("bind failed");
  return "http://127.0.0.1:" + a.port;
};
const close = (server: Server) => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));

after(async () => { await prisma.$disconnect(); });

test("syncSystemRolePermissions back-fills CRM perms onto a stale admin role, leaving custom roles untouched", async () => {
  const tenantId = "sync-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "Sync " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await seedDefaultRolesForHotel(tenantId);

  // Simulate a tenant frozen before CRM existed: strip the CRM perms from admin.
  await prisma.role.updateMany({
    where: { tenantId, key: "admin" },
    data: { permissions: JSON.stringify(["manage_requests", "view_requests"]) },
  });
  // A user-defined custom role must NOT be overwritten by the sync.
  const custom = await prisma.role.create({
    data: { tenantId, key: "custom-" + uid(), displayName: "Custom", permissions: JSON.stringify(["view_requests"]), isSystem: false, isCustom: true },
  });

  await syncSystemRolePermissions();

  const admin = await prisma.role.findFirst({ where: { tenantId, key: "admin" } });
  const adminPerms = parsePermissions(admin!.permissions);
  assert.ok(adminPerms.includes("manage_crm"), "admin should regain manage_crm");
  assert.ok(adminPerms.includes("view_crm"), "admin should regain view_crm");

  const customAfter = await prisma.role.findUnique({ where: { id: custom.id } });
  assert.deepEqual(parsePermissions(customAfter!.permissions), ["view_requests"], "custom role left untouched");
});

test("Admin can create a contact after the system-role permission sync (end-to-end)", async () => {
  const tenantId = "synce2e-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "SyncE2E " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await seedDefaultRolesForHotel(tenantId);
  // Freeze admin to a pre-CRM snapshot.
  await prisma.role.updateMany({ where: { tenantId, key: "admin" }, data: { permissions: JSON.stringify(["manage_requests", "view_requests"]) } });
  const adminRole = await prisma.role.findFirst({ where: { tenantId, key: "admin" }, select: { id: true } });
  const email = `admin+${tenantId}@test.local`;
  await prisma.user.create({ data: { tenantId, fullName: "Admin", email, role: "owner", roleId: adminRole!.id, isActive: true } });

  const server = buildServer();
  const base = await listen(server);
  try {
    const tok = await (await fetch(base + "/auth/token", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId, email, roleKey: "admin" }),
    })).json() as { token?: string };
    const auth = { authorization: "Bearer " + tok.token!, "content-type": "application/json" };

    // Before sync: the stale admin is denied (the bug from the screenshots).
    const before = await fetch(base + "/contacts", { method: "POST", headers: auth, body: JSON.stringify({ fullName: "Sanyam Pahwa" }) });
    assert.equal(before.status, 403, "stale admin is denied before sync");

    await syncSystemRolePermissions();

    // After sync: the same admin (permissions loaded live) can create the contact.
    const afterRes = await fetch(base + "/contacts", { method: "POST", headers: auth, body: JSON.stringify({ fullName: "Sanyam Pahwa" }) });
    assert.equal(afterRes.status, 201, "admin can create a contact after sync");
    const afterBody = await afterRes.json() as { ok: boolean; contact?: { fullName?: string } };
    assert.equal(afterBody.ok, true);
    assert.equal(afterBody.contact?.fullName, "Sanyam Pahwa");
  } finally { await close(server); }
});
