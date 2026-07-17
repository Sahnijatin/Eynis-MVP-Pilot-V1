import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "../../../../lib/api";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const res = await fetch(`${getApiBaseUrl()}/team/invitations/${token}`, {
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Upstream error" }));
  return NextResponse.json(data, { status: res.status });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${getApiBaseUrl()}/team/invitations/${token}/accept`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Upstream error" }));
  return NextResponse.json(data, { status: res.status });
}
