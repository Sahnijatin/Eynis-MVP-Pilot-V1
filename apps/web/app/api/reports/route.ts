import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../lib/api";

export const dynamic = "force-dynamic";

// GET /api/reports — list saved reports the user can see.
export async function GET() {
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/reports`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  return NextResponse.json(await res.json(), { status: res.status });
}

// POST /api/reports — save a new report.
export async function POST(req: NextRequest) {
  const token = await getApiToken();
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${getApiBaseUrl()}/reports`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
