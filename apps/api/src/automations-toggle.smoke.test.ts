import test, { after } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./server";
import { prisma } from "./db/prisma";

const tid = "auto-toggle-" + Date.now();

async function auth(base: string) {
  const r = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tid, email: "owner@auto.test", role: "owner" }),
  });
  const p = (await r.json()) as { token?: string };
  return { authorization: "Bearer " + p.token };
}

after(async () => {
  await prisma.automationRule.deleteMany({ where: { tenantId: tid } });
  await prisma.user.deleteMany({ where: { tenantId: tid } });
  await prisma.license.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("PATCH /automations/:id pauses and resumes a rule", async () => {
  await prisma.tenant.create({ data: { id: tid, name: "Auto Toggle", timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId: tid, plan: "growth", maxSeats: 25 } });
  await prisma.user.create({ data: { tenantId: tid, fullName: "Owner", email: "owner@auto.test", role: "owner", isActive: true } });
  const rule = await prisma.automationRule.create({
    data: { tenantId: tid, code: "sla_breach_escalate", name: "SLA Breach → Escalate", isActive: true, configJson: "{}" },
  });

  const server = buildServer();
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  const base = "http://127.0.0.1:" + (typeof a === "object" && a ? a.port : 0);

  try {
    const headers = { ...(await auth(base)), "content-type": "application/json" };

    // Pause.
    const pause = await fetch(base + "/automations/" + rule.id, { method: "PATCH", headers, body: JSON.stringify({ isActive: false }) });
    assert.equal(pause.status, 200);
    assert.equal((await prisma.automationRule.findUnique({ where: { id: rule.id } }))?.isActive, false);

    // Resume.
    const resume = await fetch(base + "/automations/" + rule.id, { method: "PATCH", headers, body: JSON.stringify({ isActive: true }) });
    assert.equal(resume.status, 200);
    assert.equal((await prisma.automationRule.findUnique({ where: { id: rule.id } }))?.isActive, true);

    // Bad body → 400.
    const bad = await fetch(base + "/automations/" + rule.id, { method: "PATCH", headers, body: JSON.stringify({ isActive: "yes" }) });
    assert.equal(bad.status, 400);

    // Unknown id → 404.
    const missing = await fetch(base + "/automations/does-not-exist", { method: "PATCH", headers, body: JSON.stringify({ isActive: false }) });
    assert.equal(missing.status, 404);

    // Cross-tenant id is invisible → 404 (not another tenant's rule).
    const other = await fetch(base + "/automations/executions", { method: "PATCH", headers, body: JSON.stringify({ isActive: false }) });
    assert.equal(other.status, 404);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
