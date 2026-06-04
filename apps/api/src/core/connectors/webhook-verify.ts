import { createHmac, timingSafeEqual } from "node:crypto";

function safeCompare(a: string, b: string): boolean {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

// Twilio: HMAC-SHA1 of (url + sorted_params), base64-encoded
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  authToken: string,
  signature: string
): boolean {
  const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  const data = url + sorted.map(([k, v]) => k + v).join("");
  const computed = createHmac("sha1", authToken).update(data).digest("base64");
  return safeCompare(computed, signature);
}

// Interakt: HMAC-SHA256 of raw body, hex digest, optionally prefixed with "sha256="
export function verifyInteraktSignature(
  rawBody: string,
  secret: string,
  signature: string
): boolean {
  const computed = createHmac("sha256", secret).update(rawBody).digest("hex");
  const sig = signature.startsWith("sha256=") ? signature.slice(7) : signature;
  return safeCompare(computed, sig);
}

/**
 * Shared-secret webhook auth (no HMAC): the caller must present `provided`
 * matching the configured `expected` secret, compared in constant time.
 *
 * Fails CLOSED in production when no secret is configured, so a misconfigured
 * deploy can never leave a data-writing webhook publicly callable (F-2). In
 * non-production it stays open for local development convenience.
 */
export function verifySharedWebhookSecret(opts: {
  expected: string | null | undefined;
  provided: string | null | undefined;
  isProduction: boolean;
}): { ok: boolean; status: number; reason?: string } {
  const expected = (opts.expected ?? "").trim();
  const provided = (opts.provided ?? "").trim();

  if (!expected) {
    if (opts.isProduction) {
      return { ok: false, status: 503, reason: "Webhook secret not configured" };
    }
    return { ok: true, status: 200 };
  }
  if (!provided || !safeCompare(provided, expected)) {
    return { ok: false, status: 401, reason: "Invalid webhook secret" };
  }
  return { ok: true, status: 200 };
}

// Vapi: a shared secret echoed back in the x-vapi-secret header (no HMAC).
// Verified by constant-time comparison against the configured secret.
export function verifyVapiSecret(provided: string, expected: string): boolean {
  if (!provided || !expected) return false;
  return safeCompare(provided, expected);
}

// Returns true if verification passes or is skipped (no signature header present + not enforced)
export function checkWebhookSignature(opts: {
  provider: "twilio" | "interakt";
  signature: string | null;
  url: string;
  rawBody: string;
  params?: Record<string, string>;
  enforce: boolean;
}): { ok: boolean; reason?: string } {
  const { provider, signature, url, rawBody, params = {}, enforce } = opts;

  if (!signature) {
    if (enforce) return { ok: false, reason: "Missing webhook signature header" };
    return { ok: true };
  }

  const authToken = provider === "twilio"
    ? process.env.TWILIO_AUTH_TOKEN
    : process.env.INTERAKT_WEBHOOK_SECRET;

  if (!authToken) {
    if (enforce) return { ok: false, reason: `${provider} secret not configured — set ${provider === "twilio" ? "TWILIO_AUTH_TOKEN" : "INTERAKT_WEBHOOK_SECRET"}` };
    return { ok: true };
  }

  const valid = provider === "twilio"
    ? verifyTwilioSignature(url, params, authToken, signature)
    : verifyInteraktSignature(rawBody, authToken, signature);

  if (!valid) {
    if (enforce) return { ok: false, reason: "Webhook signature verification failed" };
    console.warn(`[WebhookVerify] ${provider} signature mismatch — set VERIFY_WEBHOOKS=false to silence`);
  }

  return { ok: true };
}
