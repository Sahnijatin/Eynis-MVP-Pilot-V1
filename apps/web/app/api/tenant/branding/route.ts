import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../lib/api";

// Proxy for per-tenant white-label branding (GET current / PUT update).
export async function GET() {
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/tenant/branding`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function PUT(req: NextRequest) {
  const token = await getApiToken();
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${getApiBaseUrl()}/tenant/branding`, {
    method: "PUT",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
