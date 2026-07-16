import { NextRequest, NextResponse } from "next/server";
import { resolveUserContext } from "../../../lib/user-context";
import { getApiBaseUrl, getApiToken } from "../../../lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await resolveUserContext();
    return NextResponse.json({ ok: true, ...ctx });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}

// PATCH — the signed-in user updates their own profile (currently display name).
export async function PATCH(req: NextRequest) {
  const token = await getApiToken();
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${getApiBaseUrl()}/me`, {
    method: "PATCH",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
