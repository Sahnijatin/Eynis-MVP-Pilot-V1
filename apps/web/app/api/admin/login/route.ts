import { NextResponse } from "next/server";
import {
  STAFF_COOKIE,
  staffCookieValue,
  verifyStaffSecret,
  isStaffConsoleConfigured
} from "../../../../lib/platform-admin";

// POST /api/admin/login — exchange the platform-admin secret for an httpOnly
// session cookie (E-8). The raw secret is never persisted; the cookie holds only
// its hash.
export async function POST(req: Request) {
  if (!isStaffConsoleConfigured()) {
    return NextResponse.json({ ok: false, error: "Provisioning console is not configured." }, { status: 503 });
  }
  const body = (await req.json().catch(() => ({}))) as { secret?: unknown };
  const candidate = typeof body.secret === "string" ? body.secret : "";
  if (!verifyStaffSecret(candidate)) {
    return NextResponse.json({ ok: false, error: "Invalid credentials." }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(STAFF_COOKIE, staffCookieValue(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 60 * 60 * 8 // 8h staff session
  });
  return res;
}
