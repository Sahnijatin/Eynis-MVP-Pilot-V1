import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";
import { ingestConnectorEvent } from "./ingest";
import {
  detectOptOutKeyword, isQuietHour, localHour, evaluateOutboundSend,
  applyInboundOptOut, recordAutomatedSend, automatedDailyCap,
} from "./messaging-guardrails";

// #168 — WhatsApp outbound guardrails.

test("detectOptOutKeyword recognises leading STOP/START only", () => {
  assert.equal(detectOptOutKeyword("STOP"), "stop");
  assert.equal(detectOptOutKeyword("stop please"), "stop");
  assert.equal(detectOptOutKeyword("Unsubscribe."), "stop");
  assert.equal(detectOptOutKeyword("START"), "start");
  assert.equal(detectOptOutKeyword("resume messages"), "start");
  // A keyword buried mid-sentence is NOT an opt-out.
  assert.equal(detectOptOutKeyword("I want to stop by the front desk"), null);
  assert.equal(detectOptOutKeyword("please send me the menu"), null);
});

test("isQuietHour handles overnight and empty windows", () => {
  const overnight = { start: 21, end: 8 };
  assert.equal(isQuietHour(23, overnight), true);
  assert.equal(isQuietHour(2, overnight), true);
  assert.equal(isQuietHour(8, overnight), false);
  assert.equal(isQuietHour(12, overnight), false);
  const daytime = { start: 9, end: 17 };
  assert.equal(isQuietHour(12, daytime), true);
  assert.equal(isQuietHour(8, daytime), false);
  assert.equal(isQuietHour(5, { start: 5, end: 5 }), false); // empty window
});

test("localHour respects the timezone and falls back safely", () => {
  const noonUtc = new Date("2026-07-20T12:00:00Z");
  assert.equal(localHour(noonUtc, "UTC"), 12);
  assert.equal(localHour(noonUtc, "Asia/Kolkata"), 17); // +5:30
  assert.equal(localHour(noonUtc, "Not/AZone"), 12);    // invalid → UTC hour
});

const tid = "guard-" + Date.now().toString(36) + Math.random().toString(16).slice(2, 6);
const PHONE = "+919812345678";
const NOON = new Date("2026-07-20T12:00:00Z"); // non-quiet for the default 21–8 window
const NIGHT = new Date("2026-07-20T23:00:00Z"); // quiet

before(async () => {
  await prisma.tenant.create({ data: { id: tid, name: "Guard Co", timezone: "UTC" } });
});
after(async () => {
  await prisma.automatedMessageLog.deleteMany({ where: { tenantId: tid } });
  await prisma.doNotContact.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("an opted-out subject is blocked on every send kind", async () => {
  await applyInboundOptOut(tid, PHONE, "stop");
  for (const kind of ["automated", "transactional", "manual"] as const) {
    const d = await evaluateOutboundSend({ tenantId: tid, phone: PHONE, kind, now: NOON });
    assert.deepEqual(d, { allowed: false, reason: "opted_out" }, `${kind} must be blocked`);
  }

  // START lifts a reversible opt-out; a manual/erasure suppression would survive.
  await applyInboundOptOut(tid, PHONE, "start");
  const after = await evaluateOutboundSend({ tenantId: tid, phone: PHONE, kind: "manual", now: NOON });
  assert.equal(after.allowed, true, "START re-subscribes a reversible opt-out");
});

test("START never resurrects a GDPR-erased suppression", async () => {
  const erased = "+919800000001";
  await prisma.doNotContact.create({ data: { tenantId: tid, phone: erased, reason: "gdpr_erasure" } });
  await applyInboundOptOut(tid, erased, "start");
  const still = await prisma.doNotContact.findUnique({ where: { tenantId_phone: { tenantId: tid, phone: erased } } });
  assert.ok(still, "an erasure suppression must survive an inbound START");
});

test("quiet hours block automated sends but not transactional/manual", async () => {
  const phone = "+919811111111";
  assert.equal((await evaluateOutboundSend({ tenantId: tid, phone, kind: "automated", now: NIGHT })).allowed, false);
  assert.equal((await evaluateOutboundSend({ tenantId: tid, phone, kind: "transactional", now: NIGHT })).allowed, true);
  assert.equal((await evaluateOutboundSend({ tenantId: tid, phone, kind: "manual", now: NIGHT })).allowed, true);
  // Same subject during the day: automated is fine.
  assert.equal((await evaluateOutboundSend({ tenantId: tid, phone, kind: "automated", now: NOON })).allowed, true);
});

test("the daily cap blocks automated sends once the subject hits the limit", async () => {
  const phone = "+919822222222";
  const cap = automatedDailyCap();
  for (let i = 0; i < cap; i++) await recordAutomatedSend(tid, phone, "checkin_welcome");

  const blocked = await evaluateOutboundSend({ tenantId: tid, phone, kind: "automated", now: NOON });
  assert.deepEqual(blocked, { allowed: false, reason: "daily_cap" });
  // A transactional reply is never capped.
  assert.equal((await evaluateOutboundSend({ tenantId: tid, phone, kind: "transactional", now: NOON })).allowed, true);
});

test("ingest suppresses the ack reply for an opted-out subject and records it", async () => {
  const phone = "+919844444444";
  await prisma.doNotContact.create({ data: { tenantId: tid, phone, reason: "opt_out" } });
  const result = await ingestConnectorEvent({
    tenantId: tid, connectorKey: "whatsapp_twilio", guestPhone: phone,
    guestName: "Opted Out", messageText: "please fix the AC", rawPayload: {},
  });
  assert.equal(result.replySent, false, "no reply is sent to an opted-out subject");
  const ev = await prisma.connectorEvent.findUnique({ where: { id: result.connectorEventId }, select: { replyStatus: true } });
  assert.equal(ev?.replyStatus, "suppressed: opted_out", "the event records the suppression, not 'no_reply_needed'");
});

test("an inbound STOP opts the subject out before any reply", async () => {
  const phone = "+919855555555";
  const result = await ingestConnectorEvent({
    tenantId: tid, connectorKey: "whatsapp_twilio", guestPhone: phone,
    guestName: "Stopper", messageText: "STOP", rawPayload: {},
  });
  // The STOP self-suppresses, so its own ack is suppressed too.
  assert.equal(result.replySent, false);
  const dnc = await prisma.doNotContact.findUnique({ where: { tenantId_phone: { tenantId: tid, phone } } });
  assert.ok(dnc, "STOP adds the subject to the suppression list");
});

test("POST /connectors/whatsapp/send is refused (403) for an opted-out subject", async () => {
  const optedPhone = "+919833333333";
  await prisma.doNotContact.create({ data: { tenantId: tid, phone: optedPhone, reason: "opt_out" } });
  await prisma.user.create({ data: { tenantId: tid, fullName: "Owner", email: `o-${tid}@g.test`, role: "owner", isActive: true } });

  const server: Server = buildServer();
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address(); if (!a || typeof a === "string") throw new Error("bind");
  const base = "http://127.0.0.1:" + a.port;
  try {
    const tok = await fetch(base + "/auth/token", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId: tid, email: `o-${tid}@g.test`, role: "owner" }),
    });
    const { token } = await tok.json() as { token: string };
    const r = await fetch(base + "/connectors/whatsapp/send", {
      method: "POST", headers: { authorization: "Bearer " + token, "content-type": "application/json" },
      body: JSON.stringify({ toPhone: optedPhone, message: "hello" }),
    });
    assert.equal(r.status, 403);
    const body = await r.json() as { ok: boolean; error: string };
    assert.equal(body.ok, false);
    assert.match(body.error, /opted_out/);
  } finally {
    await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
  }
});
