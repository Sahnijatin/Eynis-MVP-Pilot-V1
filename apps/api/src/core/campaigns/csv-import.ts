// CSV lead import (Phase 5).
//
// Three layers, separated so the parsing/validation is pure and unit-testable
// without HTTP or a database:
//   parseMultipart()    — busboy: pull the CSV file + text fields off the request
//   parseLeadsFromCsv() — csv-parse: rows -> validated, consent-gated leads (pure)
//   bulkInsertLeads()   — dedupe (in-campaign + tenant opt-out) and insert
//
// Compliance is enforced here: every row must carry consent (Phase 1
// consentFromImport) or it is rejected, and phones are E.164-normalised.

import type { IncomingMessage } from "node:http";
import busboy from "busboy";
import { parse as parseCsv } from "csv-parse/sync";
import type { ConsentSource, LeadConsent } from "@eynis/shared";
import { consentFromImport } from "./compliance";
import { prisma } from "../../db/prisma";

// ── Multipart ─────────────────────────────────────────────────────────────────

export interface MultipartResult {
  file: { filename: string; content: Buffer } | null;
  fields: Record<string, string>;
}

export const DEFAULT_MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

export function parseMultipart(
  req: IncomingMessage,
  opts: { maxFileBytes?: number } = {},
): Promise<MultipartResult> {
  return new Promise((resolve, reject) => {
    const contentType = req.headers["content-type"] ?? "";
    if (!contentType.includes("multipart/form-data")) {
      reject(new Error("Expected multipart/form-data"));
      return;
    }
    const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
    const bb = busboy({ headers: req.headers, limits: { files: 1, fileSize: maxFileBytes } });
    const fields: Record<string, string> = {};
    let file: { filename: string; content: Buffer } | null = null;
    let truncated = false;

    bb.on("field", (name, value) => { fields[name] = value; });
    bb.on("file", (_name, stream, info) => {
      const chunks: Buffer[] = [];
      stream.on("data", (c: Buffer) => chunks.push(c));
      // busboy emits "limit" (not an error) when fileSize is exceeded and then
      // truncates the stream. Flag it so we reject instead of importing a
      // silently truncated CSV.
      stream.on("limit", () => { truncated = true; });
      stream.on("end", () => { file = { filename: info.filename, content: Buffer.concat(chunks) }; });
    });
    bb.on("close", () => {
      if (truncated) {
        reject(new Error(`CSV exceeds the ${Math.round(maxFileBytes / (1024 * 1024))}MB upload limit`));
        return;
      }
      resolve({ file, fields });
    });
    bb.on("error", (e) => reject(e instanceof Error ? e : new Error(String(e))));
    req.pipe(bb);
  });
}

// ── E.164 normalisation ───────────────────────────────────────────────────────

export function normalizeToE164(raw: string | null | undefined, defaultCountryCode: string): string | null {
  if (!raw) return null;
  let s = raw.replace(/[^\d+]/g, "");
  if (s.startsWith("00")) s = "+" + s.slice(2);
  if (!s.startsWith("+")) {
    const cc = defaultCountryCode.startsWith("+") ? defaultCountryCode : "+" + defaultCountryCode;
    s = cc + s.replace(/^0+/, ""); // drop national trunk zero before prefixing
  }
  // E.164: '+' then a country code that cannot start with 0, total 8–15 digits.
  return /^\+[1-9]\d{7,14}$/.test(s) ? s : null;
}

// ── Parse + validate (pure) ───────────────────────────────────────────────────

export type EynisLeadField = "firstName" | "lastName" | "phone" | "email" | "company" | "jobTitle" | "consent";

export interface ParsedLead {
  row: number;
  firstName: string;
  lastName: string | null;
  phone: string;
  email: string | null;
  company: string | null;
  jobTitle: string | null;
  rawData: string; // JSON of the original CSV row → {lead.custom.*}
  consent: LeadConsent;
}

export interface ImportError { row: number; reason: string }

export interface ParseOptions {
  columnMap: Record<string, EynisLeadField>; // CSV header -> Eynis field
  defaultCountryCode: string;
  defaultConsent?: boolean;       // operator attests consent for the whole file
  consentSource?: ConsentSource;  // how consent was obtained
}

export function parseLeadsFromCsv(
  csvText: string,
  opts: ParseOptions,
): { leads: ParsedLead[]; errors: ImportError[] } {
  const errors: ImportError[] = [];
  let records: Record<string, string>[];
  try {
    records = parseCsv(csvText, { columns: true, skip_empty_lines: true, trim: true, bom: true }) as Record<string, string>[];
  } catch (e) {
    return { leads: [], errors: [{ row: 0, reason: `CSV parse failed: ${(e as Error).message}` }] };
  }

  // Reverse the map: Eynis field -> CSV header (first wins).
  const headerFor: Partial<Record<EynisLeadField, string>> = {};
  for (const [header, field] of Object.entries(opts.columnMap)) {
    if (!(field in headerFor)) headerFor[field] = header;
  }

  const source: ConsentSource = opts.consentSource ?? "csv_import";
  const leads: ParsedLead[] = [];

  records.forEach((rec, i) => {
    const row = i + 1;
    const val = (field: EynisLeadField): string | null => {
      const h = headerFor[field];
      const v = h ? rec[h] : undefined;
      return v && v.trim().length > 0 ? v.trim() : null;
    };

    const firstName = val("firstName");
    if (!firstName) { errors.push({ row, reason: "missing firstName" }); return; }

    const phone = normalizeToE164(val("phone"), opts.defaultCountryCode);
    if (!phone) { errors.push({ row, reason: "missing or invalid phone (need E.164)" }); return; }

    // Consent: per-row column if mapped AND the cell is non-empty; otherwise
    // fall back to the file-level attestation (so a blank cell doesn't override
    // an operator's whole-file consent confirmation).
    let consentRaw: unknown = opts.defaultConsent === true;
    if (headerFor.consent) {
      const cell = val("consent");
      if (cell !== null) consentRaw = cell;
    }
    const consent = consentFromImport({ consentValue: consentRaw, source });
    if (!consent.consent) { errors.push({ row, reason: "no_consent" }); return; }

    leads.push({
      row,
      firstName,
      lastName: val("lastName"),
      phone,
      email: val("email"),
      company: val("company"),
      jobTitle: val("jobTitle"),
      rawData: JSON.stringify(rec),
      consent,
    });
  });

  return { leads, errors };
}

// ── Insert with dedupe (DB) ───────────────────────────────────────────────────

export interface ImportResult {
  imported: number;
  skipped: number;                 // in-campaign duplicates + tenant-wide opt-outs
  errors: ImportError[];           // validation + consent rejections
}

export async function bulkInsertLeads(
  campaignId: string,
  hotelId: string,
  parsed: ParsedLead[],
  parseErrors: ImportError[],
): Promise<ImportResult> {
  const errors = [...parseErrors];
  let skipped = 0;

  // De-dupe within the uploaded batch (keep first occurrence of each phone).
  const seen = new Set<string>();
  const batch: ParsedLead[] = [];
  for (const lead of parsed) {
    if (seen.has(lead.phone)) { skipped++; continue; }
    seen.add(lead.phone);
    batch.push(lead);
  }

  const phones = batch.map((l) => l.phone);
  if (phones.length === 0) return { imported: 0, skipped, errors };

  // Existing phones in this campaign (unique constraint would reject anyway).
  const existing = await prisma.campaignLead.findMany({
    where: { campaignId, phone: { in: phones } },
    select: { phone: true },
  });
  const existingPhones = new Set(existing.map((e) => e.phone));

  // Tenant-wide opt-outs: a phone on the durable DoNotContact suppression list
  // (survives lead/campaign deletion) OR flagged opted-out on any existing lead
  // is permanently excluded across all campaigns and channels (compliance #3).
  const [suppressed, optedOut] = await Promise.all([
    prisma.doNotContact.findMany({ where: { hotelId, phone: { in: phones } }, select: { phone: true } }),
    prisma.campaignLead.findMany({ where: { hotelId, optedOut: true, phone: { in: phones } }, select: { phone: true } }),
  ]);
  const optedOutPhones = new Set([...suppressed.map((s) => s.phone), ...optedOut.map((o) => o.phone)]);

  const toInsert = batch.filter((l) => {
    if (existingPhones.has(l.phone)) { skipped++; return false; }
    if (optedOutPhones.has(l.phone)) { skipped++; errors.push({ row: l.row, reason: "opted_out" }); return false; }
    return true;
  });

  if (toInsert.length > 0) {
    await prisma.campaignLead.createMany({
      data: toInsert.map((l) => ({
        campaignId, hotelId,
        firstName: l.firstName, lastName: l.lastName, phone: l.phone,
        email: l.email, company: l.company, jobTitle: l.jobTitle,
        rawData: l.rawData,
        consent: l.consent.consent,
        consentSource: l.consent.consentSource,
        consentAt: l.consent.consentAt ? new Date(l.consent.consentAt) : null,
      })),
      skipDuplicates: true,
    });
  }

  return { imported: toInsert.length, skipped, errors };
}

// Records a phone on the durable, tenant-wide DoNotContact suppression list and
// flags any matching leads. Idempotent. Called whenever a lead opts out (voice
// transcript, WhatsApp reply, manual, or GDPR erasure) so the exclusion is
// permanent across all future campaigns and channels (compliance #3).
export async function suppressContact(
  hotelId: string,
  phone: string,
  reason: "opt_out" | "dnd" | "manual" | "gdpr_erasure" = "opt_out",
): Promise<void> {
  await prisma.doNotContact.upsert({
    where: { hotelId_phone: { hotelId, phone } },
    create: { hotelId, phone, reason },
    update: {}, // keep the original reason/createdAt
  });
  await prisma.campaignLead.updateMany({
    where: { hotelId, phone },
    data: { optedOut: true, status: "opted_out" },
  });
}

// Whether a phone is on the suppression list (durable) for this tenant.
export async function isSuppressed(hotelId: string, phone: string): Promise<boolean> {
  const hit = await prisma.doNotContact.findUnique({
    where: { hotelId_phone: { hotelId, phone } },
    select: { id: true },
  });
  return Boolean(hit);
}
