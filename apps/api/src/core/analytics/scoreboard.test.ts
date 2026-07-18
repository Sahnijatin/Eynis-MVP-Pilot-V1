import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";

// The scoreboard lives on the /internal/ block, gated by PLATFORM_ADMIN_SECRET.
// Set it BEFORE importing the server so the platform-admin module reads it.
const SECRET = "test-platform-admin-secret-scoreboard-01";
process.env.PLATFORM_ADMIN_SECRET = SECRET;

import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";
import { computeScoreboard } from "./scoreboard";
import { backfillValueEvents } from "../attribution/recorder";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
const DAY_MS = 24 * 60 * 60 * 1000;

const listen = async (s: Server): Promise<string> => {
  await new Promise<void>((r) => s.listen(0, r));
  const a = s.address(); if (!a || typeof a === "string") throw new Error("bind");
  return "http://127.0.0.1:" + a.port;
};
const close = (s: Server) => new Promise<void>((res, rej) => s.close((e) => (e ? rej(e) : res())));
const staff = { authorization: "Bearer " + SECRET };

// A unique, made-up industry so this test's vertical contains exactly one tenant —
// deterministic assertions despite seed data / other tenants sharing the DB. An
// unknown industry falls back to the generic value model (headline = time_saved).
const industry = "sbtest_" + uid();
const tid = "sb-" + uid();

before(async () => {
  const now = Date.now();
  await prisma.tenant.create({
    data: { id: tid, name: "Scoreboard Co", timezone: "Asia/Kolkata", industry, createdAt: new Date(now - 10 * DAY_MS) },
  });
  const user = await prisma.user.create({
    data: { tenantId: tid, fullName: "Op One", email: `op-${uid()}@sb.test`, role: "agent" },
  });
  const contact = await prisma.contact.create({ data: { tenantId: tid, fullName: "Line", phoneE164: "ext:webhook:" + uid() } });
  // First live signal 8 days ago → activation = 2 days from tenant creation.
  const sr = await prisma.serviceRequest.create({
    data: {
      tenantId: tid, guestId: contact.id, category: "downtime", summary: "x", status: "resolved",
      priority: "high", source: "webhook", createdAt: new Date(now - 8 * DAY_MS), resolvedAt: new Date(now - 7 * DAY_MS),
    },
  });
  // A transition inside the 7-day window → one weekly active operator.
  await prisma.serviceRequestTransition.create({
    data: { tenantId: tid, serviceRequestId: sr.id, fromStatus: "open", toStatus: "resolved", changedByUserId: user.id },
  });
  // Paid plan → willingness-to-pay 100%.
  await prisma.license.create({ data: { tenantId: tid, plan: "growth" } });
  // One resolved SR → one value event (generic model: 15 min time_saved).
  await backfillValueEvents(tid, industry);
});

after(async () => {
  await prisma.valueEvent.deleteMany({ where: { tenantId: tid } });
  await prisma.serviceRequestTransition.deleteMany({ where: { tenantId: tid } });
  await prisma.serviceRequest.deleteMany({ where: { tenantId: tid } });
  await prisma.license.deleteMany({ where: { tenantId: tid } });
  await prisma.contact.deleteMany({ where: { tenantId: tid } });
  await prisma.user.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("computeScoreboard rolls up the five lock-decision metrics for an isolated vertical", async () => {
  const board = await computeScoreboard();
  const row = board.verticals.find((v) => v.industry === industry);
  assert.ok(row, "the made-up vertical should appear on the board");

  assert.equal(row!.tenants, 1);
  assert.equal(row!.liveTenants, 1);
  assert.equal(row!.activationAvgDays, 2, "8-days-ago first signal vs 10-days-ago creation → 2 days");
  assert.equal(row!.weeklyActiveOperators, 1);
  assert.equal(row!.attributedValue.valueType, "time_saved");
  assert.equal(row!.attributedValue.unit, "minutes");
  assert.equal(row!.attributedValue.amount, 15, "one resolved SR × 15 generic minutes");
  assert.equal(row!.paidTenants, 1);
  assert.equal(row!.wtpConversionPct, 100);
  assert.equal(row!.wonDeals, 0);
  assert.equal(row!.salesCycleAvgDays, null);
});

test("every known vertical is reported even with zero tenants", async () => {
  const board = await computeScoreboard();
  for (const key of ["hospitality", "manufacturing", "it_services", "healthcare", "travel", "fnb"]) {
    assert.ok(board.verticals.some((v) => v.industry === key), `${key} should be present`);
  }
});

let server: Server;
let base: string;

test("GET /internal/scoreboard requires the platform-admin secret", async () => {
  server = buildServer();
  base = await listen(server);
  try {
    const noAuth = await fetch(base + "/internal/scoreboard");
    assert.equal(noAuth.status, 401);

    const wrong = await fetch(base + "/internal/scoreboard", { headers: { authorization: "Bearer nope" } });
    assert.equal(wrong.status, 401);

    const ok = await fetch(base + "/internal/scoreboard", { headers: staff });
    assert.equal(ok.status, 200);
    const body = await ok.json() as { ok: boolean; verticals: unknown[]; generatedAt: string };
    assert.equal(body.ok, true);
    assert.ok(Array.isArray(body.verticals));
    assert.ok(typeof body.generatedAt === "string" && body.generatedAt.length > 0);
  } finally {
    await close(server);
  }
});
