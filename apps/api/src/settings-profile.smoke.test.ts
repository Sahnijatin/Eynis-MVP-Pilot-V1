import test, { after } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./server";
import { prisma } from "./db/prisma";

const tid = "settings-smoke-" + Date.now();

async function auth(base: string) {
  const r = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tid, email: "owner@settings.test", role: "owner" }),
  });
  const p = (await r.json()) as { token?: string };
  return { authorization: "Bearer " + p.token };
}

after(async () => {
  await prisma.user.deleteMany({ where: { tenantId: tid } });
  await prisma.license.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("PATCH /me and /tenant/profile persist real profile edits", async () => {
  await prisma.tenant.create({ data: { id: tid, name: "Old Name", timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId: tid, plan: "growth", maxSeats: 25 } });
  await prisma.user.create({ data: { tenantId: tid, fullName: "Old Name", email: "owner@settings.test", role: "owner", isActive: true } });

  const server = buildServer();
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  const base = "http://127.0.0.1:" + (typeof a === "object" && a ? a.port : 0);

  try {
    const headers = { ...(await auth(base)), "content-type": "application/json" };

    // PATCH /me — display name.
    const meRes = await fetch(base + "/me", { method: "PATCH", headers, body: JSON.stringify({ fullName: "New Name" }) });
    assert.equal(meRes.status, 200);
    const meUser = await prisma.user.findFirst({ where: { tenantId: tid }, select: { fullName: true } });
    assert.equal(meUser?.fullName, "New Name");

    // Empty name is rejected.
    const badRes = await fetch(base + "/me", { method: "PATCH", headers, body: JSON.stringify({ fullName: "  " }) });
    assert.equal(badRes.status, 400);

    // PATCH /tenant/profile — property details incl. the new address/phone columns.
    const tpRes = await fetch(base + "/tenant/profile", {
      method: "PATCH", headers,
      body: JSON.stringify({ name: "Acme HQ", timezone: "America/New_York", address: "1 Main St", phone: "+911234567890" }),
    });
    assert.equal(tpRes.status, 200);
    const t = await prisma.tenant.findUnique({ where: { id: tid }, select: { name: true, timezone: true, address: true, phone: true } });
    assert.deepEqual(t, { name: "Acme HQ", timezone: "America/New_York", address: "1 Main St", phone: "+911234567890" });

    // GET reflects the update.
    const getRes = await fetch(base + "/tenant/profile", { headers });
    const getBody = (await getRes.json()) as { ok: boolean; profile: { name: string } };
    assert.equal(getBody.profile.name, "Acme HQ");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
