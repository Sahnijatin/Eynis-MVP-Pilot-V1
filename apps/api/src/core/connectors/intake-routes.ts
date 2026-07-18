// Cross-vertical intake (#162) — cheap, WhatsApp-independent doors that turn any
// external signal into a classified ServiceRequest via the existing pipeline.
//
// Three doors, all normalising into ingestConnectorEvent() so AI classify → request
// → SLA → automations work unchanged (the issue's core requirement):
//   • POST /connectors/intake/webhook — generic inbound HTTP (MES/sensor, ticketing)
//   • POST /connectors/intake/email   — inbound email (IT helpdesk / facilities)
//   • POST /connectors/intake/csv     — batch/manual signal (floor logs, pilots)
//
// The webhook + email doors are public and gated by a shared secret
// (INTAKE_WEBHOOK_SECRET) exactly like the PMS webhook; the CSV door is an
// authenticated operator endpoint (manage_requests). None of them touch ingest.ts:
// each channel resolves a stable per-subject key (real phone, else email:<addr>,
// else ext:<source>) into the ConnectorEvent's phone slot — the same synthetic-key
// pattern the PMS webhook already uses — so contacts dedupe per subject with no
// schema change, and sendReply is off (there's no WhatsApp thread to answer).

import type { IncomingMessage, ServerResponse } from "node:http";
import { authorize, ensureTenantAccess } from "../authz";
import { json, parseObjectBody, parseRawBody, asTrimmedString, clientIp, normalizePhoneE164 } from "../../http/helpers";
import { rateLimit } from "../rate-limit";
import { verifySharedWebhookSecret } from "./webhook-verify";
import { ingestConnectorEvent } from "./ingest";
import { parseMultipart } from "../campaigns/csv-import";
import { parse as parseCsv } from "csv-parse/sync";

// Per-channel display label used for the synthetic contact name when the caller
// gives no name (e.g. an anonymous sensor webhook).
const CHANNEL_LABEL: Record<string, string> = {
  webhook: "Webhook",
  email_inbound: "Email",
  csv_import: "CSV",
};

// Cap a single CSV import so a huge upload can't fan out into hundreds of serial
// per-row AI classifications inside one request (each ingest runs a classify when an
// AI key is configured). Rows beyond the cap are reported, never silently dropped.
// A background/queued importer would lift this; kept synchronous + bounded for now.
const MAX_CSV_ROWS = Number(process.env.INTAKE_CSV_MAX_ROWS ?? 100);

export interface ContactIdentity {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  externalId?: string | null;
}

/**
 * Resolve a stable dedup key + display name for a signal's subject. Real phones
 * dedupe by E.164; otherwise a namespaced key (email:… / ext:…) keeps the value out
 * of the real-phone space so it can never collide with a genuine number. When no
 * identity is given at all, all signals from that channel fold onto one per-source
 * subject (e.g. anonymous sensor events) rather than spawning a contact per event.
 */
export function resolveSubject(id: ContactIdentity, connectorKey: string): { key: string; name: string } {
  const label = CHANNEL_LABEL[connectorKey] ?? "Intake";
  const phone = normalizePhoneE164(asTrimmedString(id.phone));
  const email = asTrimmedString(id.email)?.toLowerCase() ?? null;
  const externalId = asTrimmedString(id.externalId);
  const name = asTrimmedString(id.name) ?? email ?? externalId ?? `${label} Intake`;

  if (phone) return { key: phone, name };
  if (email) return { key: `email:${email}`, name };
  if (externalId) return { key: `ext:${connectorKey}:${externalId}`, name };
  return { key: `src:${connectorKey}`, name };
}

function readSecretHeader(req: IncomingMessage): string | null {
  const h = req.headers["x-webhook-secret"];
  return typeof h === "string" ? h : Array.isArray(h) ? h[0] ?? null : null;
}

// Parse a JSON body, answering 400 (not an unhandled 500) when an external caller
// sends malformed JSON. Returns null after writing the response.
async function readJsonBody(req: IncomingMessage, res: ServerResponse): Promise<Record<string, unknown> | null> {
  try {
    return await parseObjectBody(req);
  } catch {
    json(res, 400, { ok: false, error: "Invalid JSON body" });
    return null;
  }
}

// Best-effort plain-text from an HTML email part: drop tags and collapse whitespace
// so classification sees words, not markup.
function htmlToText(html: string | null): string | null {
  if (!html) return null;
  const text = html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return text.length ? text : null;
}

// Shared normalise → ingest step for the public doors.
async function ingestSignal(
  tenantId: string,
  connectorKey: string,
  message: string,
  identity: ContactIdentity,
  rawPayload: unknown,
) {
  const { key, name } = resolveSubject(identity, connectorKey);
  return ingestConnectorEvent({
    tenantId,
    connectorKey,
    eventType: "inbound_signal",
    guestPhone: key,
    guestName: name,
    messageText: message,
    rawPayload,
    sendReply: false, // no WhatsApp thread to reply to for these channels
  });
}

export async function handleIntakeRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = req.url ?? "";
  if (!url.startsWith("/connectors/intake/")) return false;

  const isProduction = process.env.NODE_ENV === "production";

  // ── Generic inbound webhook ────────────────────────────────────────────────
  if (url === "/connectors/intake/webhook" && req.method === "POST") {
    if (!(await rateLimit(`intake-webhook:${clientIp(req)}`, 120, 60_000))) {
      json(res, 429, { ok: false, error: "Too many requests. Please slow down." });
      return true;
    }
    const secret = verifySharedWebhookSecret({ expected: process.env.INTAKE_WEBHOOK_SECRET, provided: readSecretHeader(req), isProduction });
    if (!secret.ok) { json(res, secret.status, { ok: false, error: secret.reason ?? "Unauthorized" }); return true; }

    const body = await readJsonBody(req, res);
    if (!body) return true;
    const tenantId = asTrimmedString(body.tenantId);
    // Accept `message`, or `subject`+`text` (so ticketing systems can post either).
    const subject = asTrimmedString(body.subject);
    const text = asTrimmedString(body.text);
    const message = asTrimmedString(body.message) ?? [subject, text].filter(Boolean).join(" — ");
    if (!tenantId) { json(res, 400, { ok: false, error: "tenantId is required" }); return true; }
    if (!message) { json(res, 400, { ok: false, error: "message (or subject/text) is required" }); return true; }
    if (!(await ensureTenantAccess(tenantId))) { json(res, 404, { ok: false, error: "Tenant not found" }); return true; }

    const contact = (body.contact ?? {}) as Record<string, unknown>;
    const result = await ingestSignal(tenantId, "webhook", message, {
      name: asTrimmedString(contact.name),
      phone: asTrimmedString(contact.phone),
      email: asTrimmedString(contact.email),
      externalId: asTrimmedString(contact.externalId) ?? asTrimmedString(body.externalId),
    }, body);
    json(res, 202, { ok: true, connectorEventId: result.connectorEventId, serviceRequestId: result.serviceRequestId, classification: result.classification });
    return true;
  }

  // ── Inbound email ──────────────────────────────────────────────────────────
  // Designed to receive an email provider's inbound-parse webhook (from/subject/text).
  if (url === "/connectors/intake/email" && req.method === "POST") {
    if (!(await rateLimit(`intake-email:${clientIp(req)}`, 120, 60_000))) {
      json(res, 429, { ok: false, error: "Too many requests. Please slow down." });
      return true;
    }
    const secret = verifySharedWebhookSecret({ expected: process.env.INTAKE_WEBHOOK_SECRET, provided: readSecretHeader(req), isProduction });
    if (!secret.ok) { json(res, secret.status, { ok: false, error: secret.reason ?? "Unauthorized" }); return true; }

    const body = await readJsonBody(req, res);
    if (!body) return true;
    const tenantId = asTrimmedString(body.tenantId);
    const from = asTrimmedString(body.from);
    const subject = asTrimmedString(body.subject);
    const text = asTrimmedString(body.text) ?? htmlToText(asTrimmedString(body.html));
    const message = [subject, text].filter(Boolean).join(" — ");
    if (!tenantId) { json(res, 400, { ok: false, error: "tenantId is required" }); return true; }
    if (!from) { json(res, 400, { ok: false, error: "from (sender email) is required" }); return true; }
    if (!message) { json(res, 400, { ok: false, error: "subject or text is required" }); return true; }
    if (!(await ensureTenantAccess(tenantId))) { json(res, 404, { ok: false, error: "Tenant not found" }); return true; }

    const result = await ingestSignal(tenantId, "email_inbound", message, {
      name: asTrimmedString(body.fromName),
      email: from,
    }, body);
    json(res, 202, { ok: true, connectorEventId: result.connectorEventId, serviceRequestId: result.serviceRequestId, classification: result.classification });
    return true;
  }

  // ── CSV importer (authenticated operator endpoint) ─────────────────────────
  if (url === "/connectors/intake/csv" && req.method === "POST") {
    // authorize() enforces the manage_requests permission for this key (401/403).
    const auth = await authorize(req, res, "POST /connectors/intake/csv");
    if (!auth.ok) return true;
    const tenantId = auth.context.tenantId;
    if (!(await ensureTenantAccess(tenantId))) { json(res, 404, { ok: false, error: "Tenant not found" }); return true; }

    let file: { content: Buffer } | null;
    try {
      ({ file } = await parseMultipart(req));
    } catch (err) {
      json(res, 400, { ok: false, error: err instanceof Error ? err.message : "Invalid upload" });
      return true;
    }
    if (!file) { json(res, 400, { ok: false, error: "A CSV file is required (multipart field)" }); return true; }

    let rows: Array<Record<string, string>>;
    try {
      rows = parseCsv(file.content.toString("utf8"), {
        columns: (header: string[]) => header.map((h) => h.trim().toLowerCase()),
        skip_empty_lines: true,
        trim: true,
        bom: true,
      }) as Array<Record<string, string>>;
    } catch {
      json(res, 400, { ok: false, error: "Could not parse CSV" });
      return true;
    }

    const capped = rows.slice(0, MAX_CSV_ROWS);
    const skipped = rows.length - capped.length;
    let imported = 0;
    const failures: Array<{ row: number; error: string }> = [];

    for (let i = 0; i < capped.length; i++) {
      const row = capped[i];
      const message = asTrimmedString(row.message) ?? asTrimmedString(row.summary) ?? asTrimmedString(row.text);
      if (!message) { failures.push({ row: i + 1, error: "missing message" }); continue; }
      try {
        await ingestSignal(tenantId, "csv_import", message, {
          name: asTrimmedString(row.name),
          phone: asTrimmedString(row.phone),
          email: asTrimmedString(row.email),
          externalId: asTrimmedString(row.reference) ?? asTrimmedString(row.id),
        }, row);
        imported++;
      } catch (err) {
        failures.push({ row: i + 1, error: err instanceof Error ? err.message : "ingest failed" });
      }
    }

    json(res, 200, { ok: true, total: rows.length, imported, failed: failures.length, skipped, failures: failures.slice(0, 20) });
    return true;
  }

  return false;
}
