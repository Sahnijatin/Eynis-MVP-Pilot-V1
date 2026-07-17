import { getApiBaseUrl, getApiToken } from "../../../lib/api";

export const dynamic = "force-dynamic";

// GET → which AI providers are configured (cheap; called on mount so the toggle
// can show on/off state). No AI call is made here.
export async function GET() {
  try {
    const token = await getApiToken();
    const res = await fetch(`${getApiBaseUrl()}/ai/providers`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    const data = (await res.json().catch(() => ({ ok: false, error: "Upstream error" }))) as unknown;
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ ok: false, claude: false, openai: false }, { status: 200 });
  }
}

// POST → generate insights on demand from real per-tenant aggregates. The AI is
// only invoked here, i.e. on an explicit "Generate insights" click.
export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { provider?: string };
  const provider = body.provider === "openai" ? "openai" : "claude";
  try {
    const token = await getApiToken();
    const res = await fetch(`${getApiBaseUrl()}/ai/smart-insights?provider=${provider}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });
    const data = (await res.json().catch(() => ({ ok: false, error: "Upstream error" }))) as unknown;
    return Response.json(data, { status: res.status });
  } catch {
    return Response.json({ ok: false, error: "Unable to reach AI service" }, { status: 502 });
  }
}
