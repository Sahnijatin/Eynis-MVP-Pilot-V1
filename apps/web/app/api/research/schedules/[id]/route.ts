import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

// PATCH/DELETE /api/research/schedules/:id — change cadence / pause-resume, or
// remove a recurring re-research schedule (RS-4).
async function upstream(id: string, init: RequestInit) {
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/research/schedules/${encodeURIComponent(id)}`, {
    ...init,
    headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json().catch(() => ({ ok: false, error: "Upstream error" })), { status: res.status });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  return upstream(id, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return upstream(id, { method: "DELETE" });
}
