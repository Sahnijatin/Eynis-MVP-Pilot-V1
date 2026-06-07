import { NextRequest } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../lib/api";

export const dynamic = "force-dynamic";

// Proxy for a specific past night-audit report by date (E-15): ?date=YYYY-MM-DD.
export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get("date") ?? "";
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/night-audit/report?date=${encodeURIComponent(date)}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  return Response.json(await res.json() as unknown, { status: res.status });
}
