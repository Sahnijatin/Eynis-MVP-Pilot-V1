import { getApiBaseUrl, getApiToken } from "../../../lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const token = await getApiToken();
    const upstream = await fetch(getApiBaseUrl() + "/sse/live-feed", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store"
    });

    if (!upstream.ok || !upstream.body) {
      return new Response("SSE upstream failed", { status: 503 });
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      }
    });
  } catch {
    return new Response("SSE unavailable", { status: 503 });
  }
}
