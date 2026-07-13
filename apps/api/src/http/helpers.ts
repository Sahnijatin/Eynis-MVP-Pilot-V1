// Shared HTTP request/response helpers (improvement plan 5.1) — extracted from
// server.ts verbatim so domain routers can import them without a cycle through
// the dispatcher. Pure transport concerns only: JSON/document responses, body
// parsing with a size cap, and query/body coercion utilities.

import type { IncomingMessage, ServerResponse } from "node:http";

export const json = (res: ServerResponse, status: number, payload: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
};

// Sends a generated document (E-9 exports). `download` sets Content-Disposition so
// the browser saves the file (CSV); omit it for inline render (printable HTML).
export const sendDoc = (res: ServerResponse, contentType: string, body: string, download?: string) => {
  const headers: Record<string, string> = { "content-type": contentType };
  if (download) headers["content-disposition"] = `attachment; filename="${download.replace(/[^\w.\-]/g, "_")}"`;
  res.writeHead(200, headers);
  res.end(body);
};

// Binary variant for real PDF bytes (E-9). Always an attachment download.
export const sendBinary = (res: ServerResponse, contentType: string, body: Uint8Array, download: string) => {
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": String(body.byteLength),
    "content-disposition": `attachment; filename="${download.replace(/[^\w.\-]/g, "_")}"`
  });
  res.end(Buffer.from(body));
};

// Cap request bodies so an unauthenticated endpoint (public intake, webhooks,
// registration) can't be used to exhaust memory with a huge payload (F-34).
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? 1_048_576); // 1 MiB default

export class PayloadTooLargeError extends Error {
  constructor() { super("Request body too large"); this.name = "PayloadTooLargeError"; }
}

export const parseRawBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      req.destroy();
      throw new PayloadTooLargeError();
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
};

export const parseBody = async (req: IncomingMessage): Promise<unknown> => {
  const raw = await parseRawBody(req);
  if (!raw) return {};
  return JSON.parse(raw);
};

// Typed body reader (5.4). JSON.parse legally returns arrays/strings/numbers/null,
// which handlers blindly casting to Record<string, unknown> would then read
// properties off — this validates the root is a plain object and returns {} for
// anything else, so downstream field coercion always starts from a safe shape.
export const parseObjectBody = async (req: IncomingMessage): Promise<Record<string, unknown>> => {
  const parsed = await parseBody(req);
  return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
};

export const hasString = (value: unknown) => typeof value === "string" && value.trim().length > 0;
export const asTrimmedString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
export const asPositiveInt = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
};
export const parseUrl = (url: string | undefined) => new URL(url ?? "/", "http://localhost");
export const asSafeLimit = (value: string | null, fallback: number, max: number) => {
  const parsed = asPositiveInt(value);
  if (!parsed) {
    return fallback;
  }
  return Math.min(parsed, max);
};
export const asSafeOffset = (value: string | null) => {
  const parsed = Number(value ?? 0);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
};
// Coerce a JSON body value to a finite integer (mm/paise) or null; and to an
// optional finite number (undefined = "leave default"). Used by the quote routes.
export const numOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? Math.round(n) : null;
};
export const numUndef = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
export const dateOrNull = (v: unknown): Date | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
};
// Client IP for rate-limit keys (5.5). Behind a trusted reverse proxy (Render,
// nginx) the socket address is the proxy, so the first x-forwarded-for hop is
// the real client — but that header is caller-controlled when the app is
// exposed directly, letting an attacker rotate limiter keys. TRUST_PROXY
// defaults to true (matching the known deploys); set "false" when running
// without a proxy so only the socket address is trusted.
export const clientIp = (req: IncomingMessage): string => {
  const trustProxy = String(process.env.TRUST_PROXY ?? "true").toLowerCase() !== "false";
  if (trustProxy) {
    const fwd = req.headers["x-forwarded-for"];
    const first = typeof fwd === "string" ? fwd.split(",")[0]?.trim() : undefined;
    if (first) return first;
  }
  return req.socket.remoteAddress || "unknown";
};

// Best-effort E.164 normalisation for customer phone entry: keep a leading +, strip
// spaces/dashes, and default a bare 10-digit number to India (+91). Returns null for
// anything that can't be a phone. Not a full libphonenumber — just enough for intake.
export const normalizePhoneE164 = (raw: string | null): string | null => {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s\-()]/g, "");
  if (/^\+\d{7,15}$/.test(cleaned)) return cleaned;
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
};
