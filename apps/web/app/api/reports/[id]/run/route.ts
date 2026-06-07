import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

// GET /api/reports/:id/run — run a saved report.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/reports/${encodeURIComponent(id)}/run`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
