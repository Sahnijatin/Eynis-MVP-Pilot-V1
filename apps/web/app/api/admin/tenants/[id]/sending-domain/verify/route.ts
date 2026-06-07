import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_COOKIE, verifyStaffCookie, platformBearer } from "../../../../../../../lib/platform-admin";
import { getApiBaseUrl } from "../../../../../../../lib/api";

// POST /api/admin/tenants/:id/sending-domain/verify — staff-gated re-check (E-9).
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const cookieStore = await cookies();
  if (!verifyStaffCookie(cookieStore.get(STAFF_COOKIE)?.value)) {
    return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  }
  const { id } = await params;
  const upstream = await fetch(`${getApiBaseUrl()}/internal/tenants/${encodeURIComponent(id)}/sending-domain/verify`, {
    method: "POST",
    headers: { authorization: `Bearer ${platformBearer()}` },
    cache: "no-store"
  });
  const data = await upstream.json().catch(() => ({ ok: false, error: "Unexpected API response." }));
  return NextResponse.json(data, { status: upstream.status });
}
