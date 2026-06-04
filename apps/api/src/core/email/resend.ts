// Resend email client (Phase 3).
//
// Post-call follow-up emails. Implemented against the Resend REST API via fetch
// — the same provider-as-connector pattern used for Twilio/Interakt WhatsApp —
// so no extra npm dependency is required and the keys-last workflow holds: with
// no RESEND_API_KEY, send returns a structured { sent: false, error } result.
//
// renderTemplate() implements the campaign {variable} system so email bodies
// share the exact same namespace as voice scripts and WhatsApp messages.

import { prisma } from "../../db/prisma";

const RESEND_API_URL = "https://api.resend.com/emails";

const asStr = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

const parseConfig = (json: string): Record<string, unknown> => {
  try { return JSON.parse(json) as Record<string, unknown>; } catch { return {}; }
};

// ── Variable system ───────────────────────────────────────────────────────────

// Replaces {namespace.key} placeholders with resolved values. Unknown
// placeholders resolve to "" so customer-facing copy never leaks raw braces.
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([a-zA-Z0-9_.]+)\}/g, (_match, key: string) => vars[key] ?? "");
}

// Email bodies are authored as either plain text or HTML, then sent in Resend's
// `html` field — which renders as HTML and collapses runs of whitespace
// (including newlines) into a single space. A plain-text body therefore loses
// its line breaks. When the body has no HTML block/break markup we treat it as
// plain text: escape it and turn newlines into <br> so paragraphs survive. A
// body that already contains HTML is passed through untouched (its author
// controls layout with real tags).
const HTML_MARKUP =
  /<(?:br|p|div|table|tr|td|ul|ol|li|h[1-6]|a|span|strong|b|em|i|img|blockquote|hr|pre)\b|<\/(?:p|div|table|ul|ol|li|h[1-6]|a|span|strong|b|em|i|blockquote|pre)>/i;

export function toEmailHtml(body: string): string {
  if (HTML_MARKUP.test(body)) return body;
  const escaped = body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  return escaped.replace(/\r\n|\r|\n/g, "<br>");
}

export interface TemplateNamespaces {
  lead?: {
    firstName?: string | null; lastName?: string | null; company?: string | null;
    jobTitle?: string | null; email?: string | null; phone?: string | null;
    rawData?: string | null; // JSON blob → lead.custom.*
  };
  campaign?: { name?: string | null; calendlyLink?: string | null; [k: string]: string | null | undefined };
  tenant?: { name?: string | null; supportEmail?: string | null };
  booking?: { calendlyLink?: string | null; availableSlots?: string | null };
  call?: { summary?: string | null; sentiment?: string | null; keyPoints?: string[] | null };
}

// Flattens namespace objects into the dotted {variable} map renderTemplate uses.
export function buildTemplateVars(ns: TemplateNamespaces): Record<string, string> {
  const vars: Record<string, string> = {};
  const set = (key: string, value: unknown) => {
    if (value === null || value === undefined) return;
    vars[key] = Array.isArray(value) ? value.join(", ") : String(value);
  };

  if (ns.lead) {
    set("lead.firstName", ns.lead.firstName);
    set("lead.lastName", ns.lead.lastName);
    set("lead.company", ns.lead.company);
    set("lead.jobTitle", ns.lead.jobTitle);
    set("lead.email", ns.lead.email);
    set("lead.phone", ns.lead.phone);
    if (ns.lead.rawData) {
      try {
        const custom = JSON.parse(ns.lead.rawData) as Record<string, unknown>;
        for (const [k, v] of Object.entries(custom)) set(`lead.custom.${k}`, v);
      } catch { /* ignore malformed rawData */ }
    }
  }
  if (ns.campaign) for (const [k, v] of Object.entries(ns.campaign)) set(`campaign.${k}`, v);
  if (ns.tenant) {
    set("tenant.name", ns.tenant.name);
    set("tenant.supportEmail", ns.tenant.supportEmail);
  }
  if (ns.booking) {
    set("booking.calendlyLink", ns.booking.calendlyLink);
    set("booking.availableSlots", ns.booking.availableSlots);
  }
  if (ns.call) {
    set("call.summary", ns.call.summary);
    set("call.sentiment", ns.call.sentiment);
    set("call.keyPoints", ns.call.keyPoints ?? undefined);
  }
  return vars;
}

// ── Credential resolution (per-hotel ConnectorConfig → env fallback) ─────────

export interface ResendCredentials {
  apiKey: string | null;
  fromAddress: string | null;
  fromName: string | null;
}

export async function resolveResendCredentials(tenantId: string): Promise<ResendCredentials> {
  const cfg = await prisma.connectorConfig.findUnique({
    where: { tenantId_connectorKey: { tenantId, connectorKey: "email_resend" } },
    select: { configJson: true, enabled: true },
  }).catch(() => null);

  const parsed = cfg?.enabled ? parseConfig(cfg.configJson) : {};
  return {
    apiKey: asStr(parsed.apiKey) ?? asStr(process.env.RESEND_API_KEY),
    fromAddress: asStr(parsed.fromAddress) ?? asStr(process.env.EMAIL_FROM_ADDRESS),
    fromName: asStr(parsed.fromName) ?? asStr(process.env.EMAIL_FROM_NAME),
  };
}

export const isResendConfigured = (creds: ResendCredentials): boolean =>
  Boolean(creds.apiKey && creds.fromAddress);

// ── Send ──────────────────────────────────────────────────────────────────────

export interface SendEmailResult {
  sent: boolean;
  provider: "resend" | null;
  id?: string;
  error?: string;
}

export interface FollowUpEmailParams {
  to: string;
  subjectTemplate: string;
  htmlTemplate: string;
  vars: Record<string, string>;
}

// Renders subject + html through the {variable} system and sends via Resend.
export async function sendFollowUpEmail(
  creds: ResendCredentials,
  params: FollowUpEmailParams,
): Promise<SendEmailResult> {
  if (!isResendConfigured(creds)) {
    return { sent: false, provider: "resend", error: "Resend not configured — set RESEND_API_KEY and EMAIL_FROM_ADDRESS" };
  }
  const from = creds.fromName ? `${creds.fromName} <${creds.fromAddress}>` : creds.fromAddress!;
  const payload = {
    from,
    to: [params.to],
    subject: renderTemplate(params.subjectTemplate, params.vars),
    html: toEmailHtml(renderTemplate(params.htmlTemplate, params.vars)),
  };
  try {
    const res = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${creds.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      return { sent: false, provider: "resend", error: `Resend API error ${res.status}: ${err}` };
    }
    const data = (await res.json().catch(() => ({}))) as { id?: string };
    return { sent: true, provider: "resend", id: data.id };
  } catch (e) {
    return { sent: false, provider: "resend", error: `Resend request failed: ${(e as Error).message}` };
  }
}
