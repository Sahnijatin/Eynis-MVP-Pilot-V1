import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";
import { heuristicScore } from "./scoring";
import { heuristicStageIntent } from "./suggestions";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
const createHotel = async (tenantId: string) => {
  await prisma.tenant.create({ data: { id: tenantId, name: "CRM " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId, plan: "growth", maxSeats: 25 } });
};
const createUser = async (tenantId: string, role: string, email: string) => {
  await prisma.user.create({ data: { tenantId, fullName: "U " + role, email, role, isActive: true } });
};
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

test("heuristicScore: lifecycle + signals → bounded 0-100 with tier", () => {
  const hot = heuristicScore({ lifecycleStage: "customer", leadStatus: "qualified", openDealValue: 500000, dealCount: 3, positiveSignals: 2, negativeSignals: 0, recencyDays: 1 });
  assert.ok(hot.score >= 80 && hot.score <= 100);
  assert.equal(hot.tier, "hot");
  const cold = heuristicScore({ lifecycleStage: "lead", leadStatus: "disqualified", openDealValue: 0, dealCount: 0, positiveSignals: 0, negativeSignals: 3, recencyDays: 90 });
  assert.ok(cold.score < 30);
  assert.equal(cold.tier, "cold");
});

test("heuristicStageIntent: maps conversation keywords to movement intent", () => {
  assert.equal(heuristicStageIntent("Customer confirmed and agreed to go ahead").intent, "won");
  assert.equal(heuristicStageIntent("They said it's too expensive, not interested").intent, "lost");
  assert.equal(heuristicStageIntent("Please send a proposal and pricing").intent, "advance");
  assert.equal(heuristicStageIntent("just checking in, no news").intent, "none");
});

// ── Routes ────────────────────────────────────────────────────────────────────

test("notes & tasks: create, list open tasks, complete", async () => {
  const tenantId = "crm-" + uid();
  await createHotel(tenantId);
  const email = `owner+${tenantId}@test.local`;
  await createUser(tenantId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, tenantId, email, "owner");
    const contact = (await (await fetch(base + "/contacts", { method: "POST", headers, body: JSON.stringify({ fullName: "Tasky" }) })).json()) as any;
    const cid = contact.contact.id;

    const created = (await (await fetch(base + `/contacts/${cid}/activities`, { method: "POST", headers, body: JSON.stringify({ type: "task", title: "Call back", dueAt: "2026-07-01" }) })).json()) as any;
    assert.equal(created.activity.type, "task");
    assert.equal(created.activity.status, "open");
    const aid = created.activity.id;

    const tasks = (await (await fetch(base + "/tasks", { headers })).json()) as any;
    assert.ok(tasks.items.some((t: any) => t.id === aid));

    const done = (await (await fetch(base + `/activities/${aid}`, { method: "PATCH", headers, body: JSON.stringify({ completed: true }) })).json()) as any;
    assert.equal(done.activity.status, "done");

    const open = (await (await fetch(base + "/tasks?status=open", { headers })).json()) as any;
    assert.ok(!open.items.some((t: any) => t.id === aid));
  } finally { await stop(server); }
});

test("timeline projects notes, service requests and deal stage changes", async () => {
  const tenantId = "crm-" + uid();
  await createHotel(tenantId);
  const email = `owner+${tenantId}@test.local`;
  await createUser(tenantId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, tenantId, email, "owner");
    const contact = (await (await fetch(base + "/contacts", { method: "POST", headers, body: JSON.stringify({ fullName: "Timeline Person" }) })).json()) as any;
    const cid = contact.contact.id;
    // a manual note
    await fetch(base + `/contacts/${cid}/activities`, { method: "POST", headers, body: JSON.stringify({ type: "note", title: "Met at expo" }) });
    // a service request (channel event projected at read time)
    await prisma.serviceRequest.create({ data: { tenantId, guestId: cid, category: "concierge", status: "open", summary: "Airport pickup", priority: "normal" } });
    // a deal + a stage move (transition)
    await fetch(base + "/pipelines", { headers });
    const pipeline = (await (await fetch(base + "/pipelines", { headers })).json()) as any;
    const stages = pipeline.items[0].stages;
    const deal = (await (await fetch(base + "/deals", { method: "POST", headers, body: JSON.stringify({ title: "Expo deal", contactId: cid, stageId: stages[0].id }) })).json()) as any;
    await fetch(base + `/deals/${deal.deal.id}/move`, { method: "POST", headers, body: JSON.stringify({ stageId: stages[1].id }) });

    const tl = (await (await fetch(base + `/contacts/${cid}/timeline`, { headers })).json()) as any;
    const kinds = tl.items.map((i: any) => i.kind);
    assert.ok(kinds.includes("note"));
    assert.ok(kinds.includes("service_request"));
    assert.ok(kinds.includes("stage_change"));
  } finally { await stop(server); }
});

test("AI score endpoint persists a score + logs an ai_score activity (heuristic fallback)", async () => {
  const tenantId = "crm-" + uid();
  await createHotel(tenantId);
  const email = `owner+${tenantId}@test.local`;
  await createUser(tenantId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, tenantId, email, "owner");
    const contact = (await (await fetch(base + "/contacts", { method: "POST", headers, body: JSON.stringify({ fullName: "Score Me", lifecycleStage: "opportunity" }) })).json()) as any;
    const cid = contact.contact.id;
    const scored = (await (await fetch(base + `/contacts/${cid}/score`, { method: "POST", headers })).json()) as any;
    assert.ok(typeof scored.score.score === "number" && scored.score.score >= 0 && scored.score.score <= 100);
    const fresh = await prisma.contact.findUnique({ where: { id: cid } });
    assert.equal(fresh!.leadScore, scored.score.score);
    const logged = await prisma.activity.count({ where: { tenantId, contactId: cid, type: "ai_score" } });
    assert.equal(logged, 1);
  } finally { await stop(server); }
});

test("safe-mode suggestion: generate → list → accept performs the move", async () => {
  const tenantId = "crm-" + uid();
  await createHotel(tenantId);
  const email = `owner+${tenantId}@test.local`;
  await createUser(tenantId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, tenantId, email, "owner");
    const contact = (await (await fetch(base + "/contacts", { method: "POST", headers, body: JSON.stringify({ fullName: "Buyer" }) })).json()) as any;
    const cid = contact.contact.id;
    // A note that signals the deal is closed-won.
    await fetch(base + `/contacts/${cid}/activities`, { method: "POST", headers, body: JSON.stringify({ type: "note", title: "Call", body: "Customer confirmed and agreed to go ahead and book." }) });
    await fetch(base + "/pipelines", { headers });
    const pipeline = (await (await fetch(base + "/pipelines", { headers })).json()) as any;
    const stages = pipeline.items[0].stages;
    const wonStage = stages.find((s: any) => s.isWon);
    const deal = (await (await fetch(base + "/deals", { method: "POST", headers, body: JSON.stringify({ title: "Buyer deal", contactId: cid, stageId: stages[0].id }) })).json()) as any;
    const did = deal.deal.id;

    // Generate (heuristic, no API key) → should propose the Won stage.
    const sug = (await (await fetch(base + `/deals/${did}/suggest`, { method: "POST", headers })).json()) as any;
    assert.ok(sug.suggestion, "expected a suggestion");
    assert.equal(sug.suggestion.suggestedStageId, wonStage.id);
    const sid = sug.suggestion.id;

    // It shows up as pending. The deal is still open (safe mode — not moved yet).
    const pending = (await (await fetch(base + "/deals/suggestions?status=pending", { headers })).json()) as any;
    assert.ok(pending.items.some((s: any) => s.id === sid));
    const stillOpen = await prisma.deal.findUnique({ where: { id: did } });
    assert.equal(stillOpen!.status, "open");

    // Accept → performs the move.
    const accepted = await fetch(base + `/deals/suggestions/${sid}/accept`, { method: "POST", headers });
    assert.equal(accepted.status, 200);
    const moved = await prisma.deal.findUnique({ where: { id: did } });
    assert.equal(moved!.status, "won");
    assert.ok(moved!.closedAt);

    // No more pending suggestions.
    const after = (await (await fetch(base + "/deals/suggestions?status=pending", { headers })).json()) as any;
    assert.ok(!after.items.some((s: any) => s.id === sid));
  } finally { await stop(server); }
});

test("deal timeline de-dupes an activity linked to both the deal and its contact", async () => {
  const tenantId = "crm-" + uid();
  await createHotel(tenantId);
  const email = `owner+${tenantId}@test.local`;
  await createUser(tenantId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, tenantId, email, "owner");
    const contact = (await (await fetch(base + "/contacts", { method: "POST", headers, body: JSON.stringify({ fullName: "Dual" }) })).json()) as any;
    const cid = contact.contact.id;
    await fetch(base + "/pipelines", { headers });
    const pipeline = (await (await fetch(base + "/pipelines", { headers })).json()) as any;
    const deal = (await (await fetch(base + "/deals", { method: "POST", headers, body: JSON.stringify({ title: "D", contactId: cid, stageId: pipeline.items[0].stages[0].id }) })).json()) as any;
    const did = deal.deal.id;
    // A note logged on the contact AND linked to the deal — must not double-count.
    const act = (await (await fetch(base + `/contacts/${cid}/activities`, { method: "POST", headers, body: JSON.stringify({ type: "note", title: "Dual note", dealId: did }) })).json()) as any;
    const aid = act.activity.id;
    const tl = (await (await fetch(base + `/deals/${did}/timeline`, { headers })).json()) as any;
    const occurrences = tl.items.filter((i: any) => i.id === aid).length;
    assert.equal(occurrences, 1);
  } finally { await stop(server); }
});

test("tenant isolation: cannot accept another tenant's suggestion", async () => {
  const tenantA = "crm-" + uid();
  const tenantB = "crm-" + uid();
  await createHotel(tenantA); await createHotel(tenantB);
  const emailA = `owner+${tenantA}@test.local`;
  const emailB = `owner+${tenantB}@test.local`;
  await createUser(tenantA, "owner", emailA);
  await createUser(tenantB, "owner", emailB);
  const { server, base } = await startServer();
  try {
    const hA = await authHeaders(base, tenantA, emailA, "owner");
    const hB = await authHeaders(base, tenantB, emailB, "owner");
    const contact = (await (await fetch(base + "/contacts", { method: "POST", headers: hA, body: JSON.stringify({ fullName: "X" }) })).json()) as any;
    await fetch(base + `/contacts/${contact.contact.id}/activities`, { method: "POST", headers: hA, body: JSON.stringify({ type: "note", title: "n", body: "confirmed, go ahead and book" }) });
    await fetch(base + "/pipelines", { headers: hA });
    const pipeline = (await (await fetch(base + "/pipelines", { headers: hA })).json()) as any;
    const deal = (await (await fetch(base + "/deals", { method: "POST", headers: hA, body: JSON.stringify({ title: "d", contactId: contact.contact.id, stageId: pipeline.items[0].stages[0].id }) })).json()) as any;
    const sug = (await (await fetch(base + `/deals/${deal.deal.id}/suggest`, { method: "POST", headers: hA })).json()) as any;

    const cross = await fetch(base + `/deals/suggestions/${sug.suggestion.id}/accept`, { method: "POST", headers: hB });
    assert.equal(cross.status, 404);
  } finally { await stop(server); }
});
