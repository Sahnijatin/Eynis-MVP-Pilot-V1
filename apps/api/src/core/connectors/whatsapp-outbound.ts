import { prisma } from "../../db/prisma";

interface OutboundResult {
  sent: boolean;
  provider: string | null;
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
  return { sent: true, provider: "twilio" };
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
  return { sent: true, provider: "interakt" };
}

// ── Public: send WhatsApp message ─────────────────────────────────────────────

export async function sendWhatsAppReply(hotelId: string, toPhone: string, message: string): Promise<OutboundResult> {
  // Try Twilio first, then Interakt, based on what's configured for this hotel
  const configs = await prisma.connectorConfig.findMany({
    where: {
      hotelId,
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

export function buildReplyMessage(guestName: string, summary: string, requestId: string): string {
  const firstName = guestName.split(" ")[0] ?? guestName;
  const shortId = requestId.slice(-6).toUpperCase();
  return `Hi ${firstName}! We've received your request and our team is on it.\n\n"${summary}"\n\nRef: #${shortId} — The Riviera`;
}
