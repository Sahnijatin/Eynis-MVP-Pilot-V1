import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "./api";

// Join catch-all path segments for a backend URL, refusing traversal. A ".."
// segment survives encodeURIComponent (dots aren't escaped) and the WHATWG URL
// parser then normalizes it away — letting a crafted request climb out of the
// intended backend prefix. Reject dot segments (and any embedded separator)
// outright; the backend's authz still gates everything, but these catch-alls
// must only ever reach their own prefix.
export function joinProxyPath(segments: string[] | undefined): string | null {
  if (!segments || segments.length === 0) return "";
  for (const s of segments) {
    if (s === "." || s === ".." || s.includes("/") || s.includes("\\")) return null;
  }
  return "/" + segments.map(encodeURIComponent).join("/");
}

// Thin server-side proxy: injects the API bearer token and forwards the request to
// the backend, preserving status and (for non-JSON responses like PDF) the raw body.
// Used by the quotes/quote-templates catch-all routes so the browser never sees the
// token and CORS is never in play.
export async function proxyApi(req: NextRequest, apiPath: string): Promise<NextResponse> {
  const token = await getApiToken();
  const method = req.method.toUpperCase();
  const init: RequestInit = {
    method,
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  };
  if (method !== "GET" && method !== "HEAD") {
    const body = await req.text();
    if (body) {
      init.body = body;
      (init.headers as Record<string, string>)["content-type"] = req.headers.get("content-type") ?? "application/json";
    }
  }

  let res: Response;
  try {
    res = await fetch(`${getApiBaseUrl()}${apiPath}${req.nextUrl.search}`, init);
  } catch {
    return NextResponse.json({ ok: false, error: "Upstream request failed" }, { status: 502 });
  }

  const contentType = res.headers.get("content-type") ?? "";
  // Binary passthrough (e.g. the quote PDF) — stream bytes + disposition through.
  if (!contentType.includes("application/json")) {
    const buf = await res.arrayBuffer();
    const headers = new Headers();
    if (contentType) headers.set("content-type", contentType);
    const disp = res.headers.get("content-disposition");
    if (disp) headers.set("content-disposition", disp);
    return new NextResponse(buf, { status: res.status, headers });
  }
  const json = await res.json().catch(() => ({ ok: false, error: "Invalid upstream response" }));
  return NextResponse.json(json, { status: res.status });
}
