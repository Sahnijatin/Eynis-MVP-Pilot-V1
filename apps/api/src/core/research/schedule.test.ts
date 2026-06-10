import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";
import { advanceCadence, isCadence, runResearchScheduleCycle } from "./schedule";
import { seedDefaultRolesForHotel } from "../rbac";

// Scheduled / recurring re-research (RS-4). Covers the cadence math, the worker
// that drains due schedules into queued runs (with atomic claim → no double-run),
// and the management API. DB-backed against a real Postgres (no mocking).

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
const createHotel = async (tenantId: string) => {
  await prisma.tenant.create({ data: { id: tenantId, name: "RS " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId, plan: "growth", maxSeats: 25 } });
};
const createUser = async (tenantId: string, role: string, email: string): Promise<string> => {
  const u = await prisma.user.create({ data: { tenantId, fullName: "U " + role, email, role, isActive: true } });
  return u.id;
};
const createRun = async (tenantId: string, createdById: string, extra: Record<string, unknown> = {}) =>
  prisma.researchRun.create({
    data: { tenantId, templateName: "Brief", templateSnapshot: "{}", inputsJson: "{}", status: "ready", progress: 100, createdById, ...extra },
    select: { id: true, subjectId: true },
  });

async function startServer(): Promise<{ server: Server; base: string }> {
  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bind failed");
  return { server, base: "http://127.0.0.1:" + addr.port };
}
const stop = (server: Server) => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
const authHeaders = async (base: string, tenantId: string, email: string, role: string) => {
  const r = await fetch(base + "/auth/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId, email, role }) });
  const p = (await r.json()) as { token?: string };
  if (!p.token) throw new Error("no token");
  return { authorization: "Bearer " + p.token, "content-type": "application/json" };
};
after(async () => { await prisma.$disconnect(); });

// ── Pure helpers ──────────────────────────────────────────────────────────────

test("advanceCadence steps daily / weekly / monthly", () => {
  const base = new Date("2026-01-15T09:00:00.000Z");
  assert.equal(advanceCadence(base, "daily").toISOString(), "2026-01-16T09:00:00.000Z");
  assert.equal(advanceCadence(base, "weekly").toISOString(), "2026-01-22T09:00:00.000Z");
  assert.equal(advanceCadence(base, "monthly").toISOString(), "2026-02-15T09:00:00.000Z");
});

test("isCadence accepts known cadences only", () => {
  assert.equal(isCadence("weekly"), true);
  assert.equal(isCadence("hourly"), false);
  assert.equal(isCadence(7), false);
});

// ── Worker ──────────────────────────────────────────────────────────────────

test("the schedule worker enqueues a run for a due schedule and advances it (no double-run)", async () => {
  const tenantId = "rs-" + uid();
  await createHotel(tenantId);
  const userId = await createUser(tenantId, "housekeeping", `owner+${tenantId}@test.local`);
  const subjectId = "deal-" + uid();
  const past = new Date(Date.now() - 60_000);
  await prisma.researchSchedule.create({
    data: {
      tenantId, templateName: "Brief", templateSnapshot: "{}", inputsJson: "{}",
      subjectType: "deal", subjectId, subjectLabel: "Acme", cadence: "weekly",
      isActive: true, nextRunAt: past, createdById: userId,
    },
  });

  await runResearchScheduleCycle();

  const runs = await prisma.researchRun.findMany({ where: { tenantId, subjectId } });
  assert.equal(runs.length, 1, "one queued run created");
  assert.equal(runs[0]!.status, "queued");
  assert.equal(runs[0]!.createdById, userId);

  const sched = await prisma.researchSchedule.findFirst({ where: { tenantId, subjectId } });
  assert.ok(sched!.nextRunAt.getTime() > Date.now(), "nextRunAt advanced into the future");
  assert.ok(sched!.lastRunAt, "lastRunAt set");
  assert.equal(sched!.lastRunId, runs[0]!.id);

  // A second cycle right away must NOT enqueue again (already advanced).
  await runResearchScheduleCycle();
  const after = await prisma.researchRun.count({ where: { tenantId, subjectId } });
  assert.equal(after, 1, "no double-run");
});

test("the worker skips future and inactive schedules", async () => {
  const tenantId = "rs-" + uid();
  await createHotel(tenantId);
  const userId = await createUser(tenantId, "housekeeping", `owner+${tenantId}@test.local`);
  const future = "deal-future-" + uid();
  const paused = "deal-paused-" + uid();
  await prisma.researchSchedule.create({ data: { tenantId, templateName: "B", templateSnapshot: "{}", inputsJson: "{}", subjectType: "deal", subjectId: future, cadence: "weekly", isActive: true, nextRunAt: new Date(Date.now() + 3_600_000), createdById: userId } });
  await prisma.researchSchedule.create({ data: { tenantId, templateName: "B", templateSnapshot: "{}", inputsJson: "{}", subjectType: "deal", subjectId: paused, cadence: "weekly", isActive: false, nextRunAt: new Date(Date.now() - 60_000), createdById: userId } });

  await runResearchScheduleCycle();

  assert.equal(await prisma.researchRun.count({ where: { tenantId, subjectId: future } }), 0);
  assert.equal(await prisma.researchRun.count({ where: { tenantId, subjectId: paused } }), 0);
});

// ── API ───────────────────────────────────────────────────────────────────────

test("schedule API: create from a run, list, dedupe by subject, pause, delete", async () => {
  const tenantId = "rs-" + uid();
  await createHotel(tenantId);
  const email = `owner+${tenantId}@test.local`;
  const userId = await createUser(tenantId, "housekeeping", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, tenantId, email, "housekeeping");
    const subjectId = "deal-" + uid();
    const { id: runId } = await createRun(tenantId, userId, { subjectType: "deal", subjectId, subjectLabel: "Acme" });

    // Create.
    const created = await fetch(base + `/research/runs/${runId}/schedule`, { method: "POST", headers, body: JSON.stringify({ cadence: "weekly" }) });
    assert.equal(created.status, 201);
    const cJson = (await created.json()) as any;
    assert.equal(cJson.schedule.cadence, "weekly");
    assert.equal(cJson.schedule.isActive, true);
    const scheduleId = cJson.schedule.id;

    // Re-posting for the same subject updates in place (200, no duplicate).
    const updated = await fetch(base + `/research/runs/${runId}/schedule`, { method: "POST", headers, body: JSON.stringify({ cadence: "monthly" }) });
    assert.equal(updated.status, 200);
    assert.equal((await updated.json() as any).schedule.cadence, "monthly");
    assert.equal(await prisma.researchSchedule.count({ where: { tenantId, subjectId } }), 1);

    // The run view can read back its subject's schedule.
    const got = (await (await fetch(base + `/research/runs/${runId}/schedule`, { headers })).json()) as any;
    assert.equal(got.schedule.id, scheduleId);

    // Listed tenant-wide.
    const list = (await (await fetch(base + "/research/schedules", { headers })).json()) as any;
    assert.ok(list.items.some((s: any) => s.id === scheduleId));

    // Pause.
    const paused = await fetch(base + `/research/schedules/${scheduleId}`, { method: "PATCH", headers, body: JSON.stringify({ isActive: false }) });
    assert.equal(paused.status, 200);
    assert.equal((await paused.json() as any).schedule.isActive, false);

    // Delete.
    assert.equal((await fetch(base + `/research/schedules/${scheduleId}`, { method: "DELETE", headers })).status, 200);
    const after = (await (await fetch(base + "/research/schedules", { headers })).json()) as any;
    assert.ok(!after.items.some((s: any) => s.id === scheduleId));
  } finally { await stop(server); }
});

test("schedule API: run_research is required to create a schedule", async () => {
  const tenantId = "rs-" + uid();
  await createHotel(tenantId);
  await seedDefaultRolesForHotel(tenantId);
  const viewerRole = await prisma.role.findFirst({ where: { tenantId, key: "viewer" } });
  const viewerEmail = `viewer+${tenantId}@test.local`;
  const ownerId = await createUser(tenantId, "housekeeping", `owner+${tenantId}@test.local`);
  // A viewer has view_research but not run_research (assigned via the system role).
  await prisma.user.create({ data: { tenantId, fullName: "Viewer", email: viewerEmail, role: "housekeeping", roleId: viewerRole!.id, isActive: true } });
  const { server, base } = await startServer();
  try {
    const r = await fetch(base + "/auth/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId, email: viewerEmail, roleKey: "viewer" }) });
    const viewer = { authorization: "Bearer " + ((await r.json()) as { token: string }).token, "content-type": "application/json" };
    const { id: runId } = await createRun(tenantId, ownerId, { subjectType: "deal", subjectId: "deal-" + uid() });
    const res = await fetch(base + `/research/runs/${runId}/schedule`, { method: "POST", headers: viewer, body: JSON.stringify({ cadence: "weekly" }) });
    assert.equal(res.status, 403);
  } finally { await stop(server); }
});

test("schedule API: tenant isolation — cannot touch another tenant's schedule", async () => {
  const tenantA = "rs-" + uid();
  const tenantB = "rs-" + uid();
  await createHotel(tenantA); await createHotel(tenantB);
  const emailB = `owner+${tenantB}@test.local`;
  const userA = await createUser(tenantA, "housekeeping", `owner+${tenantA}@test.local`);
  await createUser(tenantB, "owner", emailB);
  const { server, base } = await startServer();
  try {
    const hB = await authHeaders(base, tenantB, emailB, "owner");
    const sched = await prisma.researchSchedule.create({ data: { tenantId: tenantA, templateName: "B", templateSnapshot: "{}", inputsJson: "{}", subjectType: "deal", subjectId: "d", cadence: "weekly", isActive: true, nextRunAt: new Date(), createdById: userA } });
    assert.equal((await fetch(base + `/research/schedules/${sched.id}`, { method: "PATCH", headers: hB, body: JSON.stringify({ isActive: false }) })).status, 404);
    assert.equal((await fetch(base + `/research/schedules/${sched.id}`, { method: "DELETE", headers: hB })).status, 404);
  } finally { await stop(server); }
});
