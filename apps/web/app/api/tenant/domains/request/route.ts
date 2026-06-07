import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../../lib/api";

// POST /api/tenant/domains/request — customer asks Eynis to provision a custom
// domain. Proxies to the API with the tenant token (E-10). Custom domains are
// provider-managed, so this only files a request; staff fulfil it in the console.
export async function POST(req: NextRequest) {
  const token = await getApiToken();
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${getApiBaseUrl()}/tenant/domains/request`, {
    method: "POST",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
