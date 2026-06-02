import { NextResponse } from "next/server";
import { resolveUserContext } from "../../../lib/user-context";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const ctx = await resolveUserContext();
    return NextResponse.json({ ok: true, ...ctx });
  } catch (e) {
    return NextResponse.json({ ok: false, error: String(e) }, { status: 500 });
  }
}
