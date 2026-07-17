import { NextResponse } from "next/server";
import { resolveUserContext } from "../../../lib/user-context";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await resolveUserContext();
    return NextResponse.json({ ok: true, ...ctx });
  } catch (e) {
    console.error("[api] internal error:", e);
    return NextResponse.json({ ok: false, error: "Internal error" }, { status: 500 });
  }
}
