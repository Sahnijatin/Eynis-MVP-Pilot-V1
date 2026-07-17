import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getApiBaseUrl, getApiToken } from "../../../lib/api";
import { IMPERSONATION_COOKIE, readImpersonationCookie } from "../../../lib/impersonation";

export const dynamic = "force-dynamic";

// GET — data for the impersonation modal: team members + this admin's recent
// impersonation targets. Always uses the real admin token (never an active
// impersonation session).
export async function GET() {
  try {
    const token = await getApiToken({ real: true });
    const base = getApiBaseUrl();
    const [usersRes, recentRes, ctxRes] = await Promise.all([
      fetch(`${base}/team/users`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" })
        .then(r => r.json()).catch(() => null),
      fetch(`${base}/auth/impersonations/recent`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" })
        .then(r => r.json()).catch(() => null),
      fetch(`${base}/context`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" })
        .then(r => r.json()).catch(() => null),
    ]);
    return NextResponse.json({
      ok: true,
      users: usersRes?.users ?? [],
      recent: recentRes?.recent ?? [],
      currentUserId: ctxRes?.context?.userId ?? null,
    });
  } catch (e) {
    console.error("[api] internal error:", e);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

// POST — start impersonating { targetUserId }. The API mints a token scoped to
// the target's permissions; we store it (httpOnly) so server-side renders act
// as that user.
export async function POST(req: Request) {
  try {
    const { targetUserId } = (await req.json()) as { targetUserId?: string };
    if (!targetUserId) {
      return NextResponse.json({ ok: false, error: "targetUserId is required" }, { status: 400 });
    }
    const token = await getApiToken({ real: true });
    const res = await fetch(`${getApiBaseUrl()}/auth/impersonate`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ targetUserId }),
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({ ok: false, error: "Upstream error" }));
    if (!res.ok || !data.ok) {
      return NextResponse.json({ ok: false, error: data?.error ?? "Failed to start impersonation" }, { status: res.status || 500 });
    }
    const jar = await cookies();
    jar.set(
      IMPERSONATION_COOKIE,
      JSON.stringify({ token: data.token, target: data.target, impersonator: data.impersonator }),
      {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 12 * 60 * 60,
      },
    );
    return NextResponse.json({ ok: true, target: data.target });
  } catch (e) {
    console.error("[api] internal error:", e);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}

// DELETE — stop impersonating. Logs the stop on the API (best-effort) and clears
// the cookie so subsequent renders return to the admin's own identity.
export async function DELETE() {
  try {
    const imp = await readImpersonationCookie();
    if (imp?.token) {
      try {
        await fetch(`${getApiBaseUrl()}/auth/impersonate/stop`, {
          method: "POST",
          headers: { authorization: `Bearer ${imp.token}` },
          cache: "no-store",
        });
      } catch {
        /* best-effort audit; clearing the cookie below is what ends the session */
      }
    }
    const jar = await cookies();
    jar.delete(IMPERSONATION_COOKIE);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api] internal error:", e);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
