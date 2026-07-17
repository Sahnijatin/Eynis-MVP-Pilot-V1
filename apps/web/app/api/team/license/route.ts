import { NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../lib/api";

export async function GET() {
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/team/license`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Upstream error" }));
  return NextResponse.json(data, { status: res.status });
}
