import type { IncomingMessage } from "node:http";
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
}

const encoder = new TextEncoder();
const defaultSecret = "dev-only-secret-change-me";

const getSecret = () => encoder.encode(process.env.JWT_SECRET ?? defaultSecret);

export const createAuthToken = async (claims: AuthTokenClaims) =>
  new SignJWT({
    tenantId: claims.tenantId,
    hotelId: claims.tenantId, // @deprecated alias for tokens issued before the rename
    email: claims.email,
    // Emit whichever role identities are present. A modern token carries roleKey;
    // the legacy hospitality role is included only for backward compatibility.
    ...(claims.role ? { role: claims.role } : {}),
    ...(claims.roleKey ? { roleKey: claims.roleKey } : {}),
    permissions: claims.permissions
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
    return {
      sub: payload.sub,
      tenantId,
      email: payload.email,
      role,
      roleKey,
      permissions
    };
  } catch {
    return null;
  }
};
