import type { IncomingMessage } from "node:http";
import { SignJWT, jwtVerify } from "jose";
import { isValidRole, type UserRole } from "@eynis/shared";

export interface AuthTokenClaims {
  sub: string;
  hotelId: string;
  email: string;
  role: UserRole;
  permissions: string[];
}

const encoder = new TextEncoder();
const defaultSecret = "dev-only-secret-change-me";

const getSecret = () => encoder.encode(process.env.JWT_SECRET ?? defaultSecret);

export const createAuthToken = async (claims: AuthTokenClaims) =>
  new SignJWT({
    hotelId: claims.hotelId,
    email: claims.email,
    role: claims.role,
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
    if (
      typeof payload.sub !== "string" ||
      typeof payload.hotelId !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.role !== "string" ||
      !isValidRole(payload.role)
    ) {
      return null;
    }
    const permissions = Array.isArray(payload.permissions)
      ? (payload.permissions as unknown[]).filter((p): p is string => typeof p === "string")
      : [];
    return {
      sub: payload.sub,
      hotelId: payload.hotelId,
      email: payload.email,
      role: payload.role,
      permissions
    };
  } catch {
    return null;
  }
};
