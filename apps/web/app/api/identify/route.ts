import { NextRequest, NextResponse } from "next/server";

const apiBase = () => process.env.EYNIS_API_BASE_URL ?? "http://localhost:4000";

export async function GET(req: NextRequest) {
  const email = req.nextUrl.searchParams.get("email") ?? "";
  const res = await fetch(`${apiBase()}/auth/identify?email=${encodeURIComponent(email)}`, {
    cache: "no-store",
  });
  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
