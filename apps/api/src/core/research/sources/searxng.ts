// Web search via a self-hosted SearXNG instance (RS-1). This replaces paid search
// APIs (e.g. Tavily) — SearXNG is free to run and exposes a JSON API at
// GET /search?q=...&format=json once `formats: [html, json]` is enabled in its
// settings.yml. Set SEARXNG_URL to your instance (lock its JSON API to app IPs).
// When SEARXNG_URL is unset the gather layer degrades gracefully (no web results).

import { fetchWithTimeout } from "./http";

const SEARXNG_URL = (process.env.SEARXNG_URL ?? "").replace(/\/+$/, "");
export const SEARXNG_AVAILABLE = Boolean(SEARXNG_URL);

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

interface SearxResult {
  title?: string;
  url?: string;
  content?: string;
}

export async function webSearch(query: string, maxResults = 6): Promise<SearchHit[]> {
  if (!SEARXNG_URL || !query.trim()) return [];
  const u = new URL(`${SEARXNG_URL}/search`);
  u.searchParams.set("q", query);
  u.searchParams.set("format", "json");
  u.searchParams.set("safesearch", "1");
  u.searchParams.set("language", "en");
  try {
    const res = await fetchWithTimeout(u.toString(), 12_000, { headers: { accept: "application/json" } });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: SearxResult[] };
    return (data.results ?? [])
      .map((r) => ({
        title: (r.title ?? r.url ?? "").trim(),
        url: (r.url ?? "").trim(),
        snippet: (r.content ?? "").trim().slice(0, 500),
      }))
      .filter((h) => h.url)
      .slice(0, maxResults);
  } catch {
    return [];
  }
}
