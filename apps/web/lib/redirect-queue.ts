import { sanitizeFlashMessage } from "./flash-message";

/**
 * Builds a safe redirect URL after queue actions. Whitelists path and query keys.
 */
const ALLOWED_PATHS = new Set(["/queue", "/dashboard"]);
const ALLOWED_QUERY_KEYS = new Set([
  "status",
  "slaState",
  "sortBy",
  "sortOrder",
  "assignedToMe"
]);

export function buildActionRedirectUrl(
  reqUrl: string,
  returnToRaw: string,
  returnSearchRaw: string,
  action: string,
  result: string,
  flashMessage?: string
): URL {
  const raw = returnToRaw.trim().startsWith("/") ? returnToRaw.trim() : "/queue";
  const pathname = raw.split("?")[0] ?? "/queue";
  const path = ALLOWED_PATHS.has(pathname) ? pathname : "/queue";

  const out = new URLSearchParams();
  try {
    const incoming = new URLSearchParams(returnSearchRaw);
    for (const [key, value] of incoming) {
      if (ALLOWED_QUERY_KEYS.has(key) && value.length < 200) {
        out.set(key, value);
      }
    }
  } catch {
    // ignore malformed returnSearch
  }
  out.set("action", action);
  out.set("result", result);
  if (result === "error" && flashMessage) {
    const safe = sanitizeFlashMessage(flashMessage);
    if (safe) {
      out.set("msg", safe);
    }
  }

  const base = new URL(reqUrl);
  return new URL(path + "?" + out.toString(), base.origin);
}
