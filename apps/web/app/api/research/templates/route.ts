import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../lib/api";

// List templates (builtins + tenant) / create a saved template.
export async function GET() {
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/research/templates`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}

export async function POST(req: NextRequest) {
  const token = await getApiToken();
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${getApiBaseUrl()}/research/templates`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
