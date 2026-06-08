// Tavily web search (RS — optional hosted provider). A paid API; the key is set
// per-tenant in Integrations (connector "search_tavily") or via the TAVILY_API_KEY
// env fallback. Used alongside or instead of the self-hosted SearXNG default.
// Ported from the original ai-audit services/search.py.

import { fetchWithTimeout } from "./http";
import type { SearchHit } from "./searxng";

const TAVILY_URL = "https://api.tavily.com/search";

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

export async function tavilySearch(apiKey: string, query: string, maxResults = 6): Promise<SearchHit[]> {
  if (!apiKey || !query.trim()) return [];
  try {
    const res = await fetchWithTimeout(TAVILY_URL, 12_000, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        query,
        max_results: maxResults,
        search_depth: "basic",
        include_answer: false,
        include_images: false,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: TavilyResult[] };
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
