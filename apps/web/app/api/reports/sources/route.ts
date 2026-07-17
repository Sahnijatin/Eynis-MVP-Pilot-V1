import { NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../lib/api";

export const dynamic = "force-dynamic";

// GET /api/reports/sources — builder metadata (sources + columns).
export async function GET() {
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/reports/sources`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  return NextResponse.json(await res.json().catch(() => ({ ok: false, error: "Upstream error" })), { status: res.status });
}
