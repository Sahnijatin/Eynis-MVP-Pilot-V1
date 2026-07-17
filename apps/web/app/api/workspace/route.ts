import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { WORKSPACE_COOKIE } from "../../../lib/active-workspace";
import { IMPERSONATION_COOKIE } from "../../../lib/impersonation";
import { resolveUserContext } from "../../../lib/user-context";

export const dynamic = "force-dynamic";

// Switch the active workspace. We validate that the target tenant is one the
// signed-in user actually belongs to before setting the cookie — the cookie is
// otherwise inert (resolveUserContext re-validates it on every render).
export async function POST(req: Request) {
  try {
    const { tenantId } = (await req.json()) as { tenantId?: string };
    if (!tenantId) {
      return NextResponse.json({ ok: false, error: "tenantId is required" }, { status: 400 });
    }
    const ctx = await resolveUserContext({ ignoreImpersonation: true });
    if (!ctx.workspaces.some(w => w.tenantId === tenantId)) {
      return NextResponse.json({ ok: false, error: "Not a member of that workspace" }, { status: 403 });
    }
    const jar = await cookies();
    jar.set(WORKSPACE_COOKIE, tenantId, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 365 * 24 * 60 * 60,
    });
    // Switching workspaces ends any impersonation (it was scoped to the old tenant).
    jar.delete(IMPERSONATION_COOKIE);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[api] internal error:", e);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
