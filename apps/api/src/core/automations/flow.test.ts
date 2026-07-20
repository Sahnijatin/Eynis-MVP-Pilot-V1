import test, { after } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";
import { validateFlowCreate, makeFlowCode, buildFlowConfig } from "./flow";

// ── Pure validation ────────────────────────────────────────────────────────────

test("validateFlowCreate: accepts a well-formed flow and normalises channels", () => {
  const r = validateFlowCreate({ name: "Quote chaser", trigger: "quote_no_response", action: "multi_touch_followup", channels: ["whatsapp", "email", "whatsapp"], delayHours: 72, detail: "Nudge day 3/7/14" });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.value.name, "Quote chaser");
    assert.deepEqual(r.value.channels, ["whatsapp", "email"]); // de-duped
    assert.equal(r.value.delayHours, 72);
    assert.equal(r.value.isActive, true);
  }
});

test("validateFlowCreate: rejects missing name, unknown trigger/action/channel, bad delay", () => {
  assert.equal(validateFlowCreate({ trigger: "new_lead", action: "send_whatsapp" }).ok, false);
  assert.equal(validateFlowCreate({ name: "x", trigger: "nope", action: "send_whatsapp" }).ok, false);
  assert.equal(validateFlowCreate({ name: "x", trigger: "new_lead", action: "nope" }).ok, false);
  assert.equal(validateFlowCreate({ name: "x", trigger: "new_lead", action: "send_whatsapp", channels: ["carrier_pigeon"] }).ok, false);
  assert.equal(validateFlowCreate({ name: "x", trigger: "new_lead", action: "send_whatsapp", delayHours: -1 }).ok, false);
  assert.equal(validateFlowCreate({ name: "x", trigger: "new_lead", action: "send_whatsapp", delayHours: 1.5 }).ok, false);
});

test("makeFlowCode: slugifies the name and appends the suffix; buildFlowConfig zeroes stats", () => {
  assert.equal(makeFlowCode("New Enquiry → First Response!", () => "abc123"), "flow_new_enquiry_first_response_abc123");
  assert.equal(makeFlowCode("   ", () => "zzz999"), "flow_flow_zzz999");
  const cfg = JSON.parse(buildFlowConfig({ name: "n", trigger: "new_lead", action: "send_whatsapp", channels: ["whatsapp"], delayHours: 0, detail: null, sequenceId: null, isActive: true }));
  assert.equal(cfg.ruleType, "marketing");
  assert.equal(cfg.custom, true);
  assert.deepEqual(cfg.stats, { executions: 0, conversions: 0, revenueInr: 0 });
});

// ── HTTP surface ─────────────────────────────────────────────────────────────

const tid = "auto-flow-" + Date.now();

async function auth(base: string) {
  const r = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tid, email: "owner@flow.test", role: "owner" }),
  });
  const p = (await r.json()) as { token?: string };
  return { authorization: "Bearer " + p.token, "content-type": "application/json" };
}

after(async () => {
  await prisma.automationRule.deleteMany({ where: { tenantId: tid } });
  await prisma.user.deleteMany({ where: { tenantId: tid } });
  await prisma.license.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("POST /automations creates a custom flow that appears in GET /automations", async () => {
  await prisma.tenant.create({ data: { id: tid, name: "Auto Flow", timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId: tid, plan: "growth", maxSeats: 25 } });
  await prisma.user.create({ data: { tenantId: tid, fullName: "Owner", email: "owner@flow.test", role: "owner", isActive: true } });

  const server = buildServer();
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  const base = "http://127.0.0.1:" + (typeof a === "object" && a ? a.port : 0);
  try {
    const headers = await auth(base);

    // Create a flow.
    const createRes = await fetch(base + "/automations", { method: "POST", headers, body: JSON.stringify({
      name: "Enquiry → 5-min reply", trigger: "new_lead", action: "send_whatsapp", channels: ["whatsapp", "email"], detail: "AI-personalised first response",
    }) });
    assert.equal(createRes.status, 201);
    const created = (await createRes.json()) as any;
    assert.equal(created.ok, true);
    assert.equal(created.rule.ruleType, "marketing");
    assert.equal(created.rule.trigger, "new_lead");
    assert.equal(created.rule.executions, 0);
    const id = created.rule.id;

    // It shows up in the list with its journey definition surfaced.
    const list = (await (await fetch(base + "/automations", { headers })).json()) as any;
    const row = list.items.find((i: any) => i.id === id);
    assert.ok(row, "created flow is listed");
    assert.equal(row.ruleType, "marketing");
    assert.equal(row.trigger, "new_lead");
    assert.equal(row.action, "send_whatsapp");
    assert.deepEqual(row.channels, ["whatsapp", "email"]);
    assert.equal(row.custom, true);

    // It is active and can be paused via the existing toggle.
    assert.equal(row.isActive, true);
    const pause = await fetch(base + "/automations/" + id, { method: "PATCH", headers, body: JSON.stringify({ isActive: false }) });
    assert.equal(pause.status, 200);

    // Validation failure → 400, no rule created.
    const bad = await fetch(base + "/automations", { method: "POST", headers, body: JSON.stringify({ name: "", trigger: "new_lead", action: "send_whatsapp" }) });
    assert.equal(bad.status, 400);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
