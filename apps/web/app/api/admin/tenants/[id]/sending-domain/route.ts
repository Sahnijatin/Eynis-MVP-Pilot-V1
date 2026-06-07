import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { STAFF_COOKIE, verifyStaffCookie, platformBearer } from "../../../../../../lib/platform-admin";
import { getApiBaseUrl } from "../../../../../../lib/api";

// Staff-gated proxies for the per-tenant sending domain (E-9). The platform bearer
// stays server-side; the browser only ever sends the domain/from fields.
async function authed(): Promise<boolean> {
  const cookieStore = await cookies();
  return verifyStaffCookie(cookieStore.get(STAFF_COOKIE)?.value);
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authed())) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  const { id } = await params;
  const upstream = await fetch(`${getApiBaseUrl()}/internal/tenants/${encodeURIComponent(id)}/sending-domain`, {
    headers: { authorization: `Bearer ${platformBearer()}` },
    cache: "no-store"
  });
  const data = await upstream.json().catch(() => ({ ok: false, error: "Unexpected API response." }));
  return NextResponse.json(data, { status: upstream.status });
}

export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!(await authed())) return NextResponse.json({ ok: false, error: "Not authenticated." }, { status: 401 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const upstream = await fetch(`${getApiBaseUrl()}/internal/tenants/${encodeURIComponent(id)}/sending-domain`, {
    method: "PUT",
    headers: { "content-type": "application/json", authorization: `Bearer ${platformBearer()}` },
    body: JSON.stringify({ domain: body.domain, fromLocalPart: body.fromLocalPart, fromName: body.fromName }),
    cache: "no-store"
  });
  const data = await upstream.json().catch(() => ({ ok: false, error: "Unexpected API response." }));
  return NextResponse.json(data, { status: upstream.status });
}
