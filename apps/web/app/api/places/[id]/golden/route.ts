import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../../lib/api";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await getApiToken();
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${getApiBaseUrl()}/places/${encodeURIComponent(id)}/golden`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
