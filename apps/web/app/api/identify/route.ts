import { NextResponse } from "next/server";
import { currentUser } from "@clerk/nextjs/server";
import { getApiBaseUrl, tokenExchangeHeaders } from "../../../lib/api";

// Identify the signed-in user's workspace membership(s). The email is always
// taken from the Clerk session — never from the request — so a signed-in user
// can only ever look up their own membership (no email-enumeration oracle).
// The backend /auth/identify endpoint requires the web↔API token-exchange
// secret in production; without it every call 401s and onboarding breaks.
export async function GET() {
  let email: string | null = null;
  try {
    const user = await currentUser();
    email = user?.primaryEmailAddress?.emailAddress ?? null;
  } catch {
    // Clerk not configured (dev) — fall through to the 401 below.
  }
  if (!email) {
    return NextResponse.json({ ok: false, error: "Not signed in" }, { status: 401 });
  }

  const res = await fetch(
    `${getApiBaseUrl()}/auth/identify?email=${encodeURIComponent(email)}`,
    { cache: "no-store", headers: tokenExchangeHeaders() }
  );
  const data = await res.json().catch(() => ({ ok: false, error: "Upstream error" }));
  return NextResponse.json(data, { status: res.status });
}
