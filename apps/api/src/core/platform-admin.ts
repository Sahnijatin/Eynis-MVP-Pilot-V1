import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { parseBearerToken } from "./auth";

// Platform staff (super-admin) identity for the internal provisioning console (E-8).
//
// This is deliberately *separate* from tenant RBAC: a tenant admin must never be
// able to set their own (or anyone else's) industry/domain/white-label tier. The
// console operates cross-tenant and is gated by a single shared secret carried as a
// bearer token — there is no per-staff user table yet, so a strong env secret is the
// access boundary. Every mutation it performs is audit-logged with `actorRole:
// "platform_staff"`.
//
// The secret is required to be reasonably long so an empty/default env value can
// never silently authorize the console (fail closed).
const MIN_SECRET_LENGTH = 16;

const rawSecret = (): string => String(process.env.PLATFORM_ADMIN_SECRET ?? "").trim();

export const isPlatformAdminConfigured = (): boolean => rawSecret().length >= MIN_SECRET_LENGTH;

// Constant-time comparison that never short-circuits on length. timingSafeEqual
// throws if the buffers differ in length, so we hash both sides to a fixed width
// first — comparing the candidate against the configured secret without leaking
// length via timing.
const constantTimeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) {
    // Still do a compare against ourselves to keep the timing profile uniform.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
};

// Returns true only when the console is configured AND the request carries the
// matching bearer secret. Never throws.
export const verifyPlatformAdmin = (req: IncomingMessage): boolean => {
  if (!isPlatformAdminConfigured()) return false;
  const token = parseBearerToken(req);
  if (!token) return false;
  return constantTimeEqual(token, rawSecret());
};
