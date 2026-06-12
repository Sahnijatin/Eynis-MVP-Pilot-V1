import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../lib/api";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/places/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await getApiToken();
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${getApiBaseUrl()}/places/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/places/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
