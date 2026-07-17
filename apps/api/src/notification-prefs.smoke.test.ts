import test, { after } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./server";
import { prisma } from "./db/prisma";

const tid = "notifpref-smoke-" + Date.now();

async function auth(base: string) {
  const r = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tid, email: "owner@notifpref.test", role: "owner" }),
  });
  const p = (await r.json()) as { token?: string };
  return { authorization: "Bearer " + p.token };
}

after(async () => {
  await prisma.serviceRequest.deleteMany({ where: { tenantId: tid } });
  await prisma.quote.deleteMany({ where: { tenantId: tid } });
  await prisma.inventoryItem.deleteMany({ where: { tenantId: tid } });
  await prisma.contact.deleteMany({ where: { tenantId: tid } });
  await prisma.user.deleteMany({ where: { tenantId: tid } });
  await prisma.license.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("notification prefs persist and filter the bell", async () => {
  await prisma.tenant.create({ data: { id: tid, name: "NotifPref", timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId: tid, plan: "growth", maxSeats: 25 } });
  await prisma.user.create({ data: { tenantId: tid, fullName: "Owner", email: "owner@notifpref.test", role: "owner", isActive: true } });
  const guest = await prisma.contact.create({ data: { tenantId: tid, fullName: "G", phoneE164: "+919000000009" } });
  await prisma.serviceRequest.create({ data: { tenantId: tid, guestId: guest.id, category: "maintenance", status: "open", summary: "Breach", slaBreachedAt: new Date(Date.now() - 1000) } });
  await prisma.inventoryItem.create({ data: { tenantId: tid, name: "LowItem", stock: 1, unit: "u", reorderLevel: 5 } });
  await prisma.quote.create({ data: { tenantId: tid, number: "Q-NP-1", title: "T", status: "sent", validUntil: new Date(Date.now() + 2 * 86400_000) } });

  const server = buildServer();
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  const base = "http://127.0.0.1:" + (typeof a === "object" && a ? a.port : 0);

  const cats = async (headers: Record<string, string>) => {
    const res = await fetch(base + "/notifications", { headers });
    const body = (await res.json()) as { items: { id: string }[] };
    return {
      breach: body.items.some((i) => i.id.startsWith("sr-")),
      inv: body.items.some((i) => i.id.startsWith("inv-")),
      quote: body.items.some((i) => i.id.startsWith("quote-")),
    };
  };

  try {
    const headers = { ...(await auth(base)), "content-type": "application/json" };

    // Default: all prefs on.
    const def = await fetch(base + "/me/notifications", { headers });
    assert.deepEqual((await def.json() as { prefs: unknown }).prefs, { escalations: true, inventory: true, quotes: true });
    assert.deepEqual(await cats(headers), { breach: true, inv: true, quote: true });

    // Turn off escalations → breach items disappear, others remain.
    await fetch(base + "/me/notifications", { method: "PATCH", headers, body: JSON.stringify({ escalations: false }) });
    assert.deepEqual(await cats(headers), { breach: false, inv: true, quote: true });

    // Turn off the rest → empty bell.
    await fetch(base + "/me/notifications", { method: "PATCH", headers, body: JSON.stringify({ inventory: false, quotes: false }) });
    assert.deepEqual(await cats(headers), { breach: false, inv: false, quote: false });

    // GET reflects the merged persisted prefs.
    const now = await fetch(base + "/me/notifications", { headers });
    assert.deepEqual((await now.json() as { prefs: unknown }).prefs, { escalations: false, inventory: false, quotes: false });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
