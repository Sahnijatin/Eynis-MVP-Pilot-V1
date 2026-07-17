import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "../../../lib/api";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${getApiBaseUrl()}/hotels/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Upstream error" }));
  return NextResponse.json(data, { status: res.status });
}
