import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_COOKIE, verifyStaffCookie, platformBearer } from "../../../../../../lib/platform-admin";
import { getApiBaseUrl } from "../../../../../../lib/api";

// PATCH /api/admin/tenants/:id/plan — staff-gated proxy that forwards the billing
// plan change to the API's internal route with the platform bearer. No payment
// flow — plans are provisioned per the deal (and for demo instances).
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  if (!verifyStaffCookie(cookieStore.get(STAFF_COOKIE)?.value)) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { plan?: unknown; maxSeats?: unknown; actor?: unknown };

  const upstream = await fetch(`${getApiBaseUrl()}/internal/tenants/${encodeURIComponent(id)}/plan`, {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${platformBearer()}` },
    body: JSON.stringify({ plan: body.plan, maxSeats: body.maxSeats, actor: body.actor }),
    cache: "no-store"
  });
  const data = await upstream.json().catch(() => ({ ok: false, error: "Unexpected API response." }));
  return NextResponse.json(data, { status: upstream.status });
}
