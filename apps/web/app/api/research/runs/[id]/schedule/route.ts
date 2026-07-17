import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

// GET/POST /api/research/runs/:id/schedule — proxy recurring re-research for a
// run's subject (RS-4).
async function upstream(id: string, init: RequestInit) {
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/research/runs/${encodeURIComponent(id)}/schedule`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json().catch(() => ({ ok: false, error: "Upstream error" })), { status: res.status });
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return upstream(id, {});
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return upstream(id, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}
