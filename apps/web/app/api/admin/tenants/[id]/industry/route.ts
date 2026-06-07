import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_COOKIE, verifyStaffCookie, platformBearer } from "../../../../../../lib/platform-admin";
import { getApiBaseUrl } from "../../../../../../lib/api";

// PATCH /api/admin/tenants/:id/industry — staff-gated proxy that forwards the
// industry change to the API's internal route with the platform bearer (E-8). The
// browser only ever sends the desired industry; the secret stays server-side.
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  if (!verifyStaffCookie(cookieStore.get(STAFF_COOKIE)?.value)) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { industry?: unknown; actor?: unknown };

  const upstream = await fetch(`${getApiBaseUrl()}/internal/tenants/${encodeURIComponent(id)}/industry`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${platformBearer()}` },
    body: JSON.stringify({ industry: body.industry, actor: body.actor }),
    cache: "no-store"
  });
  const data = await upstream.json().catch(() => ({ ok: false, error: "Unexpected API response." }));
  return NextResponse.json(data, { status: upstream.status });
}
