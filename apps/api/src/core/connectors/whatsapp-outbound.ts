import { prisma } from "../../db/prisma";

interface OutboundResult {
  sent: boolean;
  provider: string | null;
  id?: string; // provider message id (e.g. Twilio message SID)
  error?: string;
}

function parseConfig(json: string): Record<string, unknown> {
  try { return JSON.parse(json) as Record<string, unknown>; } catch { return {}; }
}

function asStr(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

// ── Twilio outbound ───────────────────────────────────────────────────────────

async function sendViaTwilio(config: Record<string, unknown>, toPhone: string, message: string): Promise<OutboundResult> {
  const accountSid = asStr(config.accountSid) ?? asStr(process.env.TWILIO_ACCOUNT_SID);
  const authToken = asStr(config.authToken) ?? asStr(process.env.TWILIO_AUTH_TOKEN);
  const fromNumber = asStr(config.fromNumber) ?? asStr(process.env.TWILIO_WHATSAPP_FROM);

  if (!accountSid || !authToken || !fromNumber) {
    return { sent: false, provider: "twilio", error: "Twilio credentials not configured" };
  }

  const to = toPhone.startsWith("whatsapp:") ? toPhone : `whatsapp:${toPhone}`;
  const from = fromNumber.startsWith("whatsapp:") ? fromNumber : `whatsapp:${fromNumber}`;

  const body = new URLSearchParams({ To: to, From: from, Body: message });
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body.toString()
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    return { sent: false, provider: "twilio", error: `Twilio API error ${res.status}: ${err}` };
  }
  // Return the Twilio message SID so callers can persist providerId for delivery
  // correlation (F-29) — previously this path dropped it, leaving providerId null.
  const data = (await res.json().catch(() => ({}))) as { sid?: string };
  return { sent: true, provider: "twilio", id: data.sid };
}

// ── Interakt outbound ─────────────────────────────────────────────────────────

async function sendViaInterakt(config: Record<string, unknown>, toPhone: string, message: string): Promise<OutboundResult> {
  const apiKey = asStr(config.apiKey) ?? asStr(process.env.INTERAKT_API_KEY);
  if (!apiKey) {
    return { sent: false, provider: "interakt", error: "Interakt API key not configured" };
  }

  // Strip country code prefix if present; Interakt expects countryCode + number separately
  const cleaned = toPhone.replace(/^\+/, "").replace(/\s+/g, "");
  const countryCode = cleaned.startsWith("91") ? "+91" : "+1";
  const phoneNumber = cleaned.replace(/^91/, "").replace(/^1/, "");

  const payload = {
    countryCode,
    phoneNumber,
    callbackData: "eynis-reply",
    type: "Text",
    data: { message }
  };

  const credentials = Buffer.from(apiKey).toString("base64");
  const res = await fetch("https://api.interakt.ai/v1/public/message/", {
    method: "POST",
    headers: {
      "Authorization": `Basic ${credentials}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  if (!res.ok) {
    const err = await res.text().catch(() => res.statusText);
    return { sent: false, provider: "interakt", error: `Interakt API error ${res.status}: ${err}` };
  }
  const data = (await res.json().catch(() => ({}))) as { id?: string };
  return { sent: true, provider: "interakt", id: data.id };
}

// ── Public: send WhatsApp message ─────────────────────────────────────────────

export async function sendWhatsAppReply(tenantId: string, toPhone: string, message: string): Promise<OutboundResult> {
  // Try Twilio first, then Interakt, based on what's configured for this hotel
  const configs = await prisma.connectorConfig.findMany({
    where: {
      tenantId,
      connectorKey: { in: ["whatsapp_twilio", "whatsapp_interakt"] },
      enabled: true
    },
    select: { connectorKey: true, configJson: true },
    orderBy: { connectorKey: "asc" }
  });

  for (const cfg of configs) {
    const parsed = parseConfig(cfg.configJson);
    if (cfg.connectorKey === "whatsapp_twilio") {
      const result = await sendViaTwilio(parsed, toPhone, message);
      if (result.sent) return result;
    } else if (cfg.connectorKey === "whatsapp_interakt") {
      const result = await sendViaInterakt(parsed, toPhone, message);
      if (result.sent) return result;
    }
  }

  // Fall back to env-only config (no DB config needed for demo)
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    return sendViaTwilio({}, toPhone, message);
  }
  if (process.env.INTERAKT_API_KEY) {
    return sendViaInterakt({}, toPhone, message);
  }

  return { sent: false, provider: null, error: "No WhatsApp provider configured" };
}

// Sends a pre-approved WhatsApp template (Twilio Content API) — required for
// business-initiated outbound to people who haven't messaged first. Resolves
// Twilio config from the hotel's connector config, then env. Returns the
// message SID as `id` for delivery tracking.
export async function sendWhatsAppTemplate(
  tenantId: string,
  toPhone: string,
  contentSid: string,
  contentVariables: Record<string, string>,
): Promise<OutboundResult> {
  const cfg = await prisma.connectorConfig.findUnique({
    where: { tenantId_connectorKey: { tenantId, connectorKey: "whatsapp_twilio" } },
    select: { configJson: true, enabled: true },
  }).catch(() => null);
  const parsed = cfg?.enabled ? parseConfig(cfg.configJson) : {};
  const accountSid = asStr(parsed.accountSid) ?? asStr(process.env.TWILIO_ACCOUNT_SID);
  const authToken = asStr(parsed.authToken) ?? asStr(process.env.TWILIO_AUTH_TOKEN);
  const fromNumber = asStr(parsed.fromNumber) ?? asStr(process.env.TWILIO_WHATSAPP_FROM);
  if (!accountSid || !authToken || !fromNumber) {
    return { sent: false, provider: "twilio", error: "Twilio WhatsApp not configured" };
  }

  const to = toPhone.startsWith("whatsapp:") ? toPhone : `whatsapp:${toPhone}`;
  const from = fromNumber.startsWith("whatsapp:") ? fromNumber : `whatsapp:${fromNumber}`;
  const body = new URLSearchParams({ To: to, From: from, ContentSid: contentSid });
  if (Object.keys(contentVariables).length > 0) body.set("ContentVariables", JSON.stringify(contentVariables));

  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      return { sent: false, provider: "twilio", error: `Twilio API error ${res.status}: ${err}` };
    }
    const data = (await res.json().catch(() => ({}))) as { sid?: string };
    return { sent: true, provider: "twilio", id: data.sid };
  } catch (e) {
    return { sent: false, provider: "twilio", error: `Twilio request failed: ${(e as Error).message}` };
  }
}

// White-label: the sign-off carries the tenant's own brand, never a hardcoded
// "The Riviera" (F-20). `brandName` is the tenant's branding override or name;
// falls back to a neutral sign-off when unknown.
//
// SECURITY (F-…): this reply is sent back to the customer through the tenant's own
// WhatsApp number, so it must NOT echo any model-derived / customer-derived text.
// The inbound message is fed to the classifier, and a prompt-injected message could
// steer the AI `summary` to contain a phishing link — relaying that from the brand's
// number is a trust/phishing vector. We send a fixed acknowledgment only; the AI
// summary is still stored on the ServiceRequest for staff, never sent outbound.
export function buildReplyMessage(guestName: string, _summary: string, requestId: string, brandName?: string | null): string {
  const firstName = (guestName.split(" ")[0] ?? guestName).replace(/[^\p{L}\p{N}\s'.-]/gu, "").slice(0, 40).trim() || "there";
  const shortId = requestId.slice(-6).toUpperCase();
  const signOff = brandName?.trim() ? ` — ${brandName.trim()}` : "";
  return `Hi ${firstName}! We've received your request and our team is on it. We'll be in touch shortly.\n\nRef: #${shortId}${signOff}`;
}
