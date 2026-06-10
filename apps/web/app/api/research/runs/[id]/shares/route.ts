import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

// GET/PUT /api/research/runs/:id/shares — proxy the per-run sharing ACL (RS-3).
async function upstream(id: string, init: RequestInit) {
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/research/runs/${encodeURIComponent(id)}/shares`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return upstream(id, {});
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return upstream(id, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
