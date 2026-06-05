import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../lib/api";
export async function GET(req: NextRequest) {
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/tasks${req.nextUrl.search}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  return NextResponse.json(await res.json(), { status: res.status });
}
