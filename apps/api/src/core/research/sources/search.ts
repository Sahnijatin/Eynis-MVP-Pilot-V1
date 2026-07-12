// Web-search aggregator (RS): runs every configured provider and merges the
// results, deduped by URL. Providers:
//   - SearXNG  — self-hosted default, enabled by the SEARXNG_URL env (platform-wide).
//   - Tavily   — optional hosted provider, key set per-tenant in Integrations
//                (connector "search_tavily") or via the TAVILY_API_KEY env fallback.
// Either, neither, or both can be active. Neither → no web-search evidence (crawl +
// PageSpeed still run). This is the single entry point gather.ts calls.

import { prisma } from "../../../db/prisma";
import { decryptConfigValues } from "../../crypto/secrets";
import { webSearch as searxngSearch, SEARXNG_AVAILABLE, type SearchHit } from "./searxng";
import { tavilySearch } from "./tavily";

const asStr = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// Resolve the Tavily key: per-tenant Integrations config wins, else env fallback.
async function resolveTavilyKey(tenantId: string): Promise<string | null> {
  const cfg = await prisma.connectorConfig
    .findUnique({
      where: { tenantId_connectorKey: { tenantId, connectorKey: "search_tavily" } },
      select: { configJson: true, enabled: true },
    })
    .catch(() => null);
  if (cfg?.enabled) {
    try {
      const parsed = decryptConfigValues(JSON.parse(cfg.configJson) as Record<string, unknown>);
      const key = asStr(parsed.apiKey);
      if (key) return key;
    } catch { /* fall through to env */ }
  }
  return asStr(process.env.TAVILY_API_KEY);
}

// Which providers are usable for this tenant (drives the builder's "search
// configured?" hint).
export async function searchProvidersAvailable(tenantId: string): Promise<{ searxng: boolean; tavily: boolean }> {
  return { searxng: SEARXNG_AVAILABLE, tavily: Boolean(await resolveTavilyKey(tenantId)) };
}

export async function webSearchAvailable(tenantId: string): Promise<boolean> {
  const { searxng, tavily } = await searchProvidersAvailable(tenantId);
  return searxng || tavily;
}

// Run all active providers in parallel and merge, deduped by URL (first hit wins).
export async function aggregateWebSearch(tenantId: string, query: string, maxResults = 6): Promise<SearchHit[]> {
  const tavilyKey = await resolveTavilyKey(tenantId);
  const tasks: Array<Promise<SearchHit[]>> = [];
  if (SEARXNG_AVAILABLE) tasks.push(searxngSearch(query, maxResults));
  if (tavilyKey) tasks.push(tavilySearch(tavilyKey, query, maxResults));
  if (tasks.length === 0) return [];

  const batches = await Promise.all(tasks);
  const seen = new Set<string>();
  const merged: SearchHit[] = [];
  for (const batch of batches) {
    for (const hit of batch) {
      const k = hit.url.replace(/\/+$/, "").toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      merged.push(hit);
    }
  }
  return merged.slice(0, maxResults);
}
