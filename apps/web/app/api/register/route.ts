import { NextRequest, NextResponse } from "next/server";

const apiBase = () => process.env.EYNIS_API_BASE_URL ?? "http://localhost:4000";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${apiBase()}/hotels/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
