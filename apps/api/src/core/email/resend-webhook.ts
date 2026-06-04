// Resend webhook handling — the deliverability feedback loop.
//
// Resend POSTs delivery events (delivered / bounced / complained) to us. We
// correlate each to the MessageDelivery row created on send (providerId === the
// Resend email id), update its status, and — on a hard bounce or spam complaint
// — add the recipient to the tenant's EmailSuppression list so the dispatcher
// never contacts them again. Without this loop, sending at volume silently
// destroys a tenant's sender reputation.

import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "../../db/prisma";

export interface ResendWebhookEvent {
  type?: string; // email.delivered | email.bounced | email.complained | …
  data?: {
    email_id?: string;
    to?: string[] | string;
    tags?: Array<{ name: string; value: string }>;
    bounce?: { type?: string }; // "Permanent" | "Transient"
  };
}

export interface ProcessResult { ok: boolean; action: string }

const lower = (s: string) => s.trim().toLowerCase();

async function suppress(hotelId: string, email: string, reason: "bounced" | "complained" | "manual") {
  const e = lower(email);
  if (!e) return;
  await prisma.emailSuppression.upsert({
    where: { hotelId_email: { hotelId, email: e } },
    create: { hotelId, email: e, reason },
    update: { reason },
  });
}

// Apply a single Resend event. Idempotent — safe to call on webhook retries.
export async function processResendEvent(event: ResendWebhookEvent): Promise<ProcessResult> {
  const data = event.data ?? {};
  const emailId = typeof data.email_id === "string" ? data.email_id : null;

  const delivery = emailId
    ? await prisma.messageDelivery.findFirst({
        where: { channel: "email", providerId: emailId },
        select: { id: true, hotelId: true, leadId: true },
      })
    : null;

  // hotelId/recipient come from the delivery row, falling back to the send tags
  // and the `to` field (covers events with no matching delivery, e.g. future
  // transactional mail not tracked as a campaign delivery).
  const tagHotelId = data.tags?.find((t) => t.name === "hotelId")?.value ?? null;
  const hotelId = delivery?.hotelId ?? tagHotelId ?? null;
  const recipient = Array.isArray(data.to) ? data.to[0] ?? null : (typeof data.to === "string" ? data.to : null);

  switch (event.type) {
    case "email.delivered": {
      if (delivery) await prisma.messageDelivery.update({ where: { id: delivery.id }, data: { status: "delivered", sentAt: new Date() } });
      return { ok: true, action: "delivered" };
    }
    case "email.bounced": {
      // Only permanent (hard) bounces suppress; transient bounces may be retried.
      const permanent = (data.bounce?.type ?? "Permanent").toLowerCase() === "permanent";
      if (delivery) await prisma.messageDelivery.update({ where: { id: delivery.id }, data: { status: "failed", error: "bounced" } });
      if (permanent && hotelId && recipient) await suppress(hotelId, recipient, "bounced");
      return { ok: true, action: permanent ? "suppressed_bounce" : "transient_bounce" };
    }
    case "email.complained": {
      if (delivery) await prisma.messageDelivery.update({ where: { id: delivery.id }, data: { status: "failed", error: "complained" } });
      if (hotelId && recipient) {
        await suppress(hotelId, recipient, "complained");
        // A spam complaint withdraws consent — opt the lead out across channels.
        if (delivery?.leadId) await prisma.campaignLead.update({ where: { id: delivery.leadId }, data: { optedOut: true } }).catch(() => { /* lead may be gone */ });
      }
      return { ok: true, action: "suppressed_complaint" };
    }
    default:
      return { ok: true, action: "ignored" };
  }
}

// Svix signature verification (the scheme Resend uses). Returns true when the
// signature matches the secret. `secret` is the `whsec_…` value from Resend.
// Header `svix-signature` is a space-separated list of `v1,<base64sig>`.
export function verifyResendSignature(
  secret: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  rawBody: string,
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest("base64");
  const expBuf = Buffer.from(expected);
  // Any of the space-separated `v1,<sig>` entries may match.
  return signature.split(" ").some((part) => {
    const sig = part.includes(",") ? part.split(",")[1] : part;
    const sigBuf = Buffer.from(sig);
    return sigBuf.length === expBuf.length && timingSafeEqual(sigBuf, expBuf);
  });
}
