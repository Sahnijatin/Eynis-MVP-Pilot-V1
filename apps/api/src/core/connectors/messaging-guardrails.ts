// WhatsApp/BSP outbound guardrails (#168) — the safety gate the operational
// (non-campaign) senders consult before sending. Enforces, in order:
//   1. Opt-out / DND — honours the durable, tenant-wide DoNotContact list (the
//      same list the campaign senders use), so a subject who texted STOP (or was
//      manually suppressed / GDPR-erased) is never contacted again. Applies to
//      EVERY send kind, including manual staff sends.
//   2. Quiet hours — no AUTOMATED send lands in the subject's overnight window
//      (tenant-timezone-aware).
//   3. Daily cap — no more than N AUTOMATED messages per subject per rolling 24h.
//
// Quiet-hours + cap apply to automated, engine-driven sends only. A transactional
// reply to a message the subject just sent, and a manual staff send, are gated on
// opt-out alone (they are solicited / human-initiated), never capped.
//
// The campaign dialler/sender have their own guard (core/campaigns/guard.ts, with
// consent + TRAI DND scrub); this is the operational-channel complement so the
// automation engine and the /connectors/whatsapp/send endpoint can't spam either.

import { prisma } from "../../db/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;

function intFromEnv(name: string, dflt: number): number {
  const n = Number(process.env[name]);
  return Number.isInteger(n) && n >= 0 ? n : dflt;
}

/** Max automated messages per subject per rolling 24h. Env-overridable. */
export function automatedDailyCap(): number {
  return intFromEnv("WHATSAPP_AUTOMATED_DAILY_CAP", 6);
}

/** Quiet-hours window [start, end) in the tenant's local time, 0–23. Overnight when start > end. */
export function quietHours(): { start: number; end: number } {
  return { start: intFromEnv("WHATSAPP_QUIET_START_HOUR", 21), end: intFromEnv("WHATSAPP_QUIET_END_HOUR", 8) };
}

// The hour (0–23) at `now` in an IANA timezone. Falls back to UTC hour if the
// timezone string is invalid, so a bad tenant.timezone never throws mid-send.
export function localHour(now: Date, timezone: string): number {
  try {
    const s = new Intl.DateTimeFormat("en-US", { hour: "2-digit", hour12: false, timeZone: timezone }).format(now);
    const h = parseInt(s, 10);
    // "24" is emitted by some engines for midnight — normalise to 0.
    return Number.isFinite(h) ? h % 24 : now.getUTCHours();
  } catch {
    return now.getUTCHours();
  }
}

export function isQuietHour(hour: number, window = quietHours()): boolean {
  const { start, end } = window;
  if (start === end) return false; // empty window
  return start < end ? hour >= start && hour < end : hour >= start || hour < end;
}

/** True if this subject is on the tenant's durable suppression list (opt-out/DND/erasure). */
export async function isSuppressed(tenantId: string, phone: string): Promise<boolean> {
  const row = await prisma.doNotContact.findUnique({
    where: { tenantId_phone: { tenantId, phone } },
    select: { id: true },
  });
  return Boolean(row);
}

export type SendKind = "automated" | "transactional" | "manual";
export type GuardDecision = { allowed: true } | { allowed: false; reason: string };

/**
 * Decide whether an outbound message may be sent. `automated` sends face all three
 * gates; `transactional`/`manual` sends are gated on opt-out only.
 */
export async function evaluateOutboundSend(opts: {
  tenantId: string;
  phone: string;
  kind: SendKind;
  now?: Date;
}): Promise<GuardDecision> {
  const now = opts.now ?? new Date();

  if (await isSuppressed(opts.tenantId, opts.phone)) {
    return { allowed: false, reason: "opted_out" };
  }
  if (opts.kind !== "automated") {
    return { allowed: true };
  }

  const tenant = await prisma.tenant.findUnique({ where: { id: opts.tenantId }, select: { timezone: true } });
  const hour = localHour(now, tenant?.timezone ?? "UTC");
  if (isQuietHour(hour)) {
    return { allowed: false, reason: "quiet_hours" };
  }

  const since = new Date(now.getTime() - DAY_MS);
  const sentToday = await prisma.automatedMessageLog.count({
    where: { tenantId: opts.tenantId, address: opts.phone, createdAt: { gte: since } },
  });
  if (sentToday >= automatedDailyCap()) {
    return { allowed: false, reason: "daily_cap" };
  }
  return { allowed: true };
}

/** Record an automated send so it counts toward the subject's daily cap. */
export async function recordAutomatedSend(tenantId: string, phone: string, kind: string): Promise<void> {
  await prisma.automatedMessageLog.create({ data: { tenantId, address: phone, kind } });
}

// Inbound opt-out keywords (WhatsApp/BSP convention). Detected on the whole
// trimmed message so "STOP", "stop please", "Please UNSUBSCRIBE" all count, but a
// mention of the word inside a longer sentence ("I want to stop by the desk")
// does not — we require the keyword to be the leading token.
const STOP_WORDS = ["stop", "unsubscribe", "cancel", "end", "quit", "optout", "opt-out"];
const START_WORDS = ["start", "unstop", "subscribe", "resume"];

export function detectOptOutKeyword(text: string): "stop" | "start" | null {
  const t = text.trim().toLowerCase().replace(/[.!,]+$/, "");
  const first = t.split(/\s+/)[0] ?? "";
  if (STOP_WORDS.includes(t) || STOP_WORDS.includes(first)) return "stop";
  if (START_WORDS.includes(t) || START_WORDS.includes(first)) return "start";
  return null;
}

/**
 * Apply an inbound STOP/START to the durable suppression list. STOP adds an
 * opt-out row (idempotent); START removes it — but only when the reason is a
 * user-reversible opt-out/DND, never a manual or gdpr_erasure suppression, so a
 * "START" can't resurrect a legally-erased or staff-blocked contact.
 */
export async function applyInboundOptOut(tenantId: string, phone: string, keyword: "stop" | "start"): Promise<void> {
  if (keyword === "stop") {
    await prisma.doNotContact.upsert({
      where: { tenantId_phone: { tenantId, phone } },
      update: {}, // keep the existing (possibly stronger) reason
      create: { tenantId, phone, reason: "opt_out" },
    });
    return;
  }
  await prisma.doNotContact.deleteMany({
    where: { tenantId, phone, reason: { in: ["opt_out", "dnd"] } },
  });
}
