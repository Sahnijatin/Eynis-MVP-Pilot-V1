import { NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../lib/api";

// Proxy the real top-bar notification feed. Lazily fetched by the bell when it
// opens, so it adds no per-page cost.
export async function GET() {
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/notifications`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
