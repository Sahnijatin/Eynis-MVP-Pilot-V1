// Shared fetch helper for the gather layer (RS-1). Node 22 ships a global fetch;
// we only add a timeout (so a slow upstream can't stall a run) and a desktop UA.

const USER_AGENT =
  process.env.RESEARCH_USER_AGENT ??
  "Mozilla/5.0 (compatible; EynisResearchBot/1.0; +https://eynis.example/bot)";

export async function fetchWithTimeout(
  url: string,
  timeoutMs: number,
  init: RequestInit = {},
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, ...(init.headers ?? {}) },
    });
  } finally {
    clearTimeout(timer);
  }
}
