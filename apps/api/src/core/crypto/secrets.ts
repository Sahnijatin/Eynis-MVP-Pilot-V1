// Application-layer encryption for secrets at rest (F-… H6).
//
// Connector credentials (Twilio/Interakt/Resend/Vapi/OpenAI/Anthropic/Tavily keys)
// live in ConnectorConfig.configJson. This module encrypts the sensitive VALUES with
// AES-256-GCM so a DB dump/backup leak or a read-only SQL foothold does not expose
// every tenant's third-party keys.
//
// BACKWARD-COMPATIBLE BY DESIGN:
//   • No SECRETS_ENC_KEY set  → encryptSecret is a no-op and values stay plaintext
//     (identical to the pre-existing behaviour — safe to deploy with no config change).
//   • Key set                 → new writes are encrypted; reads transparently decrypt
//     an "enc:v1:" value and pass through any legacy plaintext value unchanged, so
//     existing rows keep working and get encrypted on their next save.
//
// The key is read from SECRETS_ENC_KEY (32-byte hex, base64, or any string — hashed
// to 32 bytes as a fallback). Never logged.

import crypto from "node:crypto";

const MARKER = "enc:v1:";
const RAW = process.env.SECRETS_ENC_KEY?.trim();

function resolveKey(): Buffer | null {
  if (!RAW) return null;
  // 64 hex chars → 32 bytes; else 44-ish base64 → 32 bytes; else hash to 32 bytes.
  if (/^[0-9a-fA-F]{64}$/.test(RAW)) return Buffer.from(RAW, "hex");
  try {
    const b = Buffer.from(RAW, "base64");
    if (b.length === 32) return b;
  } catch { /* fall through */ }
  return crypto.createHash("sha256").update(RAW).digest();
}
const KEY = resolveKey();

export const secretsEncryptionEnabled = (): boolean => KEY !== null;

// Fail fast at startup if a production deploy would write tenant secrets in
// plaintext (mirrors assertJwtSecretConfigured, F-22): the no-key no-op mode is
// a dev/test convenience, not an acceptable production posture. The overrides
// exist for tests only — production callers pass nothing.
export const assertSecretsEncryptionConfigured = (opts: { isProduction?: boolean; keyConfigured?: boolean } = {}): void => {
  const isProduction = opts.isProduction ?? process.env.NODE_ENV === "production";
  const keyConfigured = opts.keyConfigured ?? KEY !== null;
  if (isProduction && !keyConfigured) {
    throw new Error("SECRETS_ENC_KEY must be set in production — without it, tenant connector credentials are stored in plaintext");
  }
};

// Encrypt a plaintext secret. No-op when encryption is disabled, the value is empty,
// or the value is already encrypted (idempotent).
export function encryptSecret(plain: string): string {
  if (!KEY || !plain || plain.startsWith(MARKER)) return plain;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return MARKER + Buffer.concat([iv, tag, enc]).toString("base64");
}

// Decrypt a value produced by encryptSecret. A non-marked (legacy plaintext) value is
// returned as-is. If the marker is present but the key is missing/wrong, the original
// string is returned (the caller's auth will fail cleanly rather than the app crash).
export function decryptSecret(value: string): string {
  if (!value || !value.startsWith(MARKER)) return value;
  if (!KEY) return value;
  try {
    const raw = Buffer.from(value.slice(MARKER.length), "base64");
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const data = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    return value;
  }
}

// Convenience for config blobs: decrypt every "enc:v1:" string value in a parsed
// object (non-marked values pass through untouched). Used by credential resolvers.
export function decryptConfigValues<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = { ...obj };
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === "string" && v.startsWith(MARKER)) out[k] = decryptSecret(v);
  }
  return out as T;
}

// SHA-256 hash for opaque tokens (e.g. invitation tokens) stored at rest, so the DB
// never holds the usable token. Compared with timingSafeEqual on the hashes.
export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}
