import type { IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { isValidRole, isSystemRoleKey, type UserRole, type SystemRoleKey } from "@eynis/shared";

export interface AuthTokenClaims {
  sub: string;
  tenantId: string;
  email: string;
  /** @deprecated legacy hospitality role — retained for backward compat. */
  role?: UserRole | null;
  /** Canonical generic role key (admin/manager/supervisor/agent/viewer). */
  roleKey?: SystemRoleKey | null;
  permissions: string[];
  /**
   * Impersonation (E-6). When present, this token authenticates as the *target*
   * user (sub/email/roleKey/permissions are the target's) but records the
   * original admin who started the session. The backend is therefore the source
   * of truth for impersonation — it is never inferred from client state.
   */
  impersonatorUserId?: string | null;
  impersonatorEmail?: string | null;
}

const encoder = new TextEncoder();
const defaultSecret = "dev-only-secret-change-me";

const getSecret = () => encoder.encode(process.env.JWT_SECRET ?? defaultSecret);

// Fail fast at startup if a production deploy is still using the hardcoded dev
// secret (or none): with the default secret, anyone who reads the source can forge
// tokens for any tenant (F-22).
export const assertJwtSecretConfigured = (): void => {
  if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || process.env.JWT_SECRET === defaultSecret)) {
    throw new Error("JWT_SECRET must be set to a strong, non-default value in production");
  }
};

// ── Token-exchange service secret (Phase 9 / C1) ───────────────────────────────
// /auth/token and /auth/identify are the identity boundary. The web tier has
// already authenticated the person with Clerk, so these endpoints must accept
// only the web tier — not anyone on the internet who knows an email address.
// Enforce-when-configured (same pattern as webhook verification): set the shared
// secret and it's required; unset in dev keeps local workflows open. Production
// REQUIRES it via the startup assertion below.
const exchangeSecret = () => process.env.EYNIS_TOKEN_EXCHANGE_SECRET?.trim() || null;

export const assertTokenExchangeConfigured = (opts: { isProduction?: boolean; configured?: boolean } = {}): void => {
  const isProduction = opts.isProduction ?? process.env.NODE_ENV === "production";
  const configured = opts.configured ?? exchangeSecret() !== null;
  if (isProduction && !configured) {
    throw new Error("EYNIS_TOKEN_EXCHANGE_SECRET must be set in production — without it, anyone who knows an email can mint tenant JWTs (C1)");
  }
};

export const verifyTokenExchangeSecret = (req: IncomingMessage): boolean => {
  const expected = exchangeSecret();
  if (!expected) return true; // not configured → open (dev only; prod asserts at startup)
  const header = req.headers["x-token-exchange-secret"];
  const provided = typeof header === "string" ? header : Array.isArray(header) ? header[0] ?? "" : "";
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const createAuthToken = async (claims: AuthTokenClaims) =>
  new SignJWT({
    tenantId: claims.tenantId,
    hotelId: claims.tenantId, // @deprecated alias for tokens issued before the rename
    email: claims.email,
    // Emit whichever role identities are present. A modern token carries roleKey;
    // the legacy hospitality role is included only for backward compatibility.
    ...(claims.role ? { role: claims.role } : {}),
    ...(claims.roleKey ? { roleKey: claims.roleKey } : {}),
    permissions: claims.permissions,
    ...(claims.impersonatorUserId ? { impersonatorUserId: claims.impersonatorUserId } : {}),
    ...(claims.impersonatorEmail ? { impersonatorEmail: claims.impersonatorEmail } : {})
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(getSecret());

export const parseBearerToken = (req: IncomingMessage): string | null => {
  const auth = req.headers.authorization;
  if (!auth || typeof auth !== "string") {
    return null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  return match?.[1] ?? null;
};

export const verifyAuthToken = async (token: string): Promise<AuthTokenClaims | null> => {
  try {
    const result = await jwtVerify(token, getSecret());
    const payload = result.payload;
    // Accept `tenantId`, falling back to the legacy `hotelId` claim so tokens
    // issued before the rename remain valid until they expire.
    const tenantId = typeof payload.tenantId === "string" ? payload.tenantId
      : (typeof payload.hotelId === "string" ? payload.hotelId : null);
    if (
      typeof payload.sub !== "string" ||
      !tenantId ||
      typeof payload.email !== "string"
    ) {
      return null;
    }
    // Resolve both role identities. A token is valid if it carries at least one:
    // the canonical roleKey OR the legacy hospitality role (backward compat).
    const role = typeof payload.role === "string" && isValidRole(payload.role) ? payload.role : null;
    const roleKey = typeof payload.roleKey === "string" && isSystemRoleKey(payload.roleKey) ? payload.roleKey : null;
    if (!role && !roleKey) {
      return null;
    }
    const permissions = Array.isArray(payload.permissions)
      ? (payload.permissions as unknown[]).filter((p): p is string => typeof p === "string")
      : [];
    const impersonatorUserId = typeof payload.impersonatorUserId === "string" ? payload.impersonatorUserId : null;
    const impersonatorEmail = typeof payload.impersonatorEmail === "string" ? payload.impersonatorEmail : null;
    return {
      sub: payload.sub,
      tenantId,
      email: payload.email,
      role,
      roleKey,
      permissions,
      impersonatorUserId,
      impersonatorEmail
    };
  } catch {
    return null;
  }
};
