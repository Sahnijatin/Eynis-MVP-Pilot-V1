import { NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../lib/api";

// Recent tenant activity for the shell's notification panel. Clerk-gated by the
// middleware (not public); the tenant scope comes from the server-side token.
export async function GET() {
  try {
    const token = await getApiToken();
    const res = await fetch(`${getApiBaseUrl()}/dashboard/live-feed`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({ ok: false, items: [] }));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ ok: false, items: [] }, { status: 200 });
  }
}
