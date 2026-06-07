// Resend Domains API client for per-tenant white-label sending domains (E-9).
//
// Keys-last, like the rest of the email stack: with no platform RESEND_API_KEY we
// don't call Resend at all — we synthesise the standard DNS records the tenant
// must publish and return status "pending". The console still works end-to-end in
// dev; live verification simply "lights up" once a key is present. Every call is
// best-effort and never throws — it returns a structured result the caller stores.

const RESEND_DOMAINS_URL = "https://api.resend.com/domains";

const platformKey = (): string | null => {
  const k = process.env.RESEND_API_KEY?.trim();
  return k && k.length ? k : null;
};

export interface DnsRecord {
  type: string;   // TXT | MX | CNAME
  name: string;   // host/record name
  value: string;  // record value
  priority?: number;
}

export interface DomainProvisionResult {
  resendDomainId: string | null;
  status: "pending" | "verified" | "failed";
  dnsRecords: DnsRecord[];
  live: boolean; // true when the provider was actually contacted
}

// The records every sender domain needs — used as the offline template and as a
// sane fallback if the provider response omits them.
function templateRecords(domain: string): DnsRecord[] {
  return [
    { type: "TXT", name: domain, value: "v=spf1 include:amazonses.com ~all" },
    { type: "TXT", name: `resend._domainkey.${domain}`, value: "<DKIM public key — published after domain is registered with the provider>" },
    { type: "TXT", name: `_dmarc.${domain}`, value: "v=DMARC1; p=none;" }
  ];
}

const mapStatus = (s: unknown): "pending" | "verified" | "failed" => {
  const v = String(s ?? "").toLowerCase();
  if (v === "verified") return "verified";
  if (v === "failed" || v === "failure" || v === "not_started") return v === "not_started" ? "pending" : "failed";
  return "pending";
};

// Normalises Resend's records[] (shape varies) into our DnsRecord[].
function parseRecords(raw: unknown, domain: string): DnsRecord[] {
  if (!Array.isArray(raw)) return templateRecords(domain);
  const out: DnsRecord[] = [];
  for (const r of raw as Array<Record<string, unknown>>) {
    const type = typeof r.type === "string" ? r.type : typeof r.record === "string" ? r.record : null;
    const name = typeof r.name === "string" ? r.name : null;
    const value = typeof r.value === "string" ? r.value : null;
    if (type && name && value) {
      const rec: DnsRecord = { type, name, value };
      if (typeof r.priority === "number") rec.priority = r.priority;
      out.push(rec);
    }
  }
  return out.length ? out : templateRecords(domain);
}

// Register (or look up) a sending domain with the provider and return its DNS
// records + current status. Offline (no key): returns a pending template.
export async function provisionSendingDomain(domain: string): Promise<DomainProvisionResult> {
  const key = platformKey();
  if (!key) {
    return { resendDomainId: null, status: "pending", dnsRecords: templateRecords(domain), live: false };
  }
  try {
    const res = await fetch(RESEND_DOMAINS_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: domain })
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; status?: string; records?: unknown };
    if (!res.ok || !data.id) {
      return { resendDomainId: null, status: "failed", dnsRecords: templateRecords(domain), live: true };
    }
    return { resendDomainId: data.id, status: mapStatus(data.status), dnsRecords: parseRecords(data.records, domain), live: true };
  } catch {
    return { resendDomainId: null, status: "pending", dnsRecords: templateRecords(domain), live: false };
  }
}

export interface DomainStatusResult {
  status: "pending" | "verified" | "failed";
  dnsRecords?: DnsRecord[];
  live: boolean;
}

// Ask the provider to (re)verify and report current status. Offline: no-op.
export async function refreshSendingDomain(resendDomainId: string | null, domain: string): Promise<DomainStatusResult> {
  const key = platformKey();
  if (!key || !resendDomainId) return { status: "pending", live: false };
  try {
    // Trigger a verification run, then read status. Both are best-effort.
    await fetch(`${RESEND_DOMAINS_URL}/${encodeURIComponent(resendDomainId)}/verify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` }
    }).catch(() => null);
    const res = await fetch(`${RESEND_DOMAINS_URL}/${encodeURIComponent(resendDomainId)}`, {
      headers: { Authorization: `Bearer ${key}` }
    });
    const data = (await res.json().catch(() => ({}))) as { status?: string; records?: unknown };
    if (!res.ok) return { status: "failed", live: true };
    return { status: mapStatus(data.status), dnsRecords: parseRecords(data.records, domain), live: true };
  } catch {
    return { status: "pending", live: false };
  }
}

// Validates a sending-domain hostname (no scheme/path, a real dotted domain).
export function isValidSendingDomain(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const v = value.trim().toLowerCase();
  return /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(v);
}

// Validates an email local part (the bit before @).
export function isValidLocalPart(value: unknown): value is string {
  if (typeof value !== "string") return false;
  return /^[a-z0-9](?:[a-z0-9._-]{0,62}[a-z0-9])?$/i.test(value.trim());
}
