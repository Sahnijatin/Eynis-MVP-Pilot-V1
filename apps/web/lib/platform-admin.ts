import { createHash, timingSafeEqual } from "node:crypto";

// Server-only helpers for the internal Eynis-staff provisioning console (E-8).
//
// The console is gated by `PLATFORM_ADMIN_SECRET` — the same secret the API
// requires on its `/internal/*` routes. The web holds it in its server env and
// uses it as the bearer when proxying to the API, so the raw secret never reaches
// the browser. After login we set an httpOnly cookie containing only the SHA-256
// of the secret (not the secret itself), so a stolen cookie can't be replayed as
// the API bearer.
//
// These functions reference node:crypto + process.env and must only ever run on
// the server (route handlers / server components).

const MIN_SECRET_LENGTH = 16;

const secret = (): string => String(process.env.PLATFORM_ADMIN_SECRET ?? "").trim();

export const isStaffConsoleConfigured = (): boolean => secret().length >= MIN_SECRET_LENGTH;

export const STAFF_COOKIE = "eynis_staff";

// Cookie value = hash of the secret. Deterministic so the server can verify it on
// later requests without storing session state.
export const staffCookieValue = (): string => createHash("sha256").update(secret()).digest("hex");

const constantTimeEqual = (a: string, b: string): boolean => {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
};

// True when the supplied login secret matches the configured one.
export const verifyStaffSecret = (candidate: string): boolean =>
  isStaffConsoleConfigured() && constantTimeEqual(candidate, secret());

// True when the request's httpOnly cookie proves a prior successful login.
export const verifyStaffCookie = (value: string | undefined): boolean =>
  isStaffConsoleConfigured() && !!value && constantTimeEqual(value, staffCookieValue());

// The bearer the web uses when calling the API's /internal/* routes.
export const platformBearer = (): string => secret();
