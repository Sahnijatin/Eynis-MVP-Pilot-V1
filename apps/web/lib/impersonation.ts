import { cookies } from "next/headers";
import { currentUser } from "@clerk/nextjs/server";

// Server-side impersonation state (E-6). The impersonation token is minted and
// signed by the API; the web treats it as opaque and stores it (plus the
// display identities) in an httpOnly cookie. Because every server-side API call
// flows through `getApiToken()`, presenting this token makes the whole app act
// as the impersonated user — the backend stays the source of truth.

export const IMPERSONATION_COOKIE = "eynis_impersonation";

export interface ImpersonationState {
  token: string;
  target: { id: string; email: string; fullName: string | null; roleKey: string | null };
  impersonator: { id: string; email: string; fullName: string | null };
}

export async function readImpersonationCookie(): Promise<ImpersonationState | null> {
  try {
    const raw = (await cookies()).get(IMPERSONATION_COOKIE)?.value;
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ImpersonationState;
    if (!parsed?.token || !parsed?.impersonator?.email || !parsed?.target?.email) return null;
    return parsed;
  } catch {
    return null;
  }
}

// Returns the active impersonation only if it belongs to the currently signed-in
// user (the impersonator). This guards against a stale cookie leaking the session
// across sign-outs / account switches on a shared browser.
export async function getActiveImpersonation(): Promise<ImpersonationState | null> {
  const imp = await readImpersonationCookie();
  if (!imp) return null;
  let email: string | null = null;
  try {
    const u = await currentUser();
    email = u?.primaryEmailAddress?.emailAddress?.toLowerCase() ?? null;
  } catch {
    /* Clerk not configured */
  }
  if (!email || email !== imp.impersonator.email.toLowerCase()) return null;
  return imp;
}
