import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../lib/api";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/segments/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  return NextResponse.json(await res.json().catch(() => ({ ok: false, error: "Upstream error" })), { status: res.status });
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = await getApiToken();
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${getApiBaseUrl()}/segments/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json().catch(() => ({ ok: false, error: "Upstream error" })), { status: res.status });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/segments/${encodeURIComponent(id)}`, {
    method: "DELETE", headers: { Authorization: `Bearer ${token}` },
  });
  return NextResponse.json(await res.json().catch(() => ({ ok: false, error: "Upstream error" })), { status: res.status });
}
