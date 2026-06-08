// Gather layer (RS-1). Runs the enabled, self-hosted sources for a template and
// returns structured evidence plus a compact text summary used by synthesis.
// Cost profile: SearXNG + crawl + PageSpeed are all free/self-hosted, and crawled
// pages are cached per-tenant (ResearchSourceCache) so repeat runs don't re-fetch.

import { createHash } from "node:crypto";
import { prisma } from "../../db/prisma";
import type { ResearchTemplateDef } from "./types";
import { aggregateWebSearch } from "./sources/search";
import type { SearchHit } from "./sources/searxng";
import { fetchReadable } from "./sources/crawl";
import { fetchPageSpeed } from "./sources/pagespeed";

export interface GatheredSource {
  kind: "search" | "page" | "pagespeed";
  title: string;
  url?: string;
  snippet?: string;
  content?: string;
  data?: Record<string, string>;
}

export interface GatherResult {
  sources: GatheredSource[];
  summary: string; // compact evidence digest for synthesis prompts
  fetchedCount: number;
  cacheHits: number; // crawled pages served from the per-tenant cache (cost saved)
}

// Replace {key} tokens in a string from the resolved inputs (plus {name} = subject).
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] ?? "").trim());
}

const CACHE_TTL_MS = Number(process.env.RESEARCH_CACHE_TTL_MS ?? 7 * 24 * 60 * 60 * 1000); // 7d
const urlHash = (url: string): string => createHash("sha256").update(url.toLowerCase()).digest("hex");

// Crawl a URL through the per-tenant cache. A fresh hit is reused; otherwise we
// fetch, store, and return. Cache misses/failures never throw.
async function crawlCached(tenantId: string, url: string): Promise<{ url: string; title: string; text: string; cached: boolean } | null> {
  const hash = urlHash(url);
  const cached = await prisma.researchSourceCache
    .findUnique({ where: { tenantId_urlHash: { tenantId, urlHash: hash } } })
    .catch(() => null);
  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    return { url: cached.url, title: "", text: cached.content, cached: true };
  }
  const page = await fetchReadable(url);
  if (!page) return null;
  await prisma.researchSourceCache
    .upsert({
      where: { tenantId_urlHash: { tenantId, urlHash: hash } },
      update: { content: page.text, url: page.url, fetchedAt: new Date() },
      create: { tenantId, urlHash: hash, url: page.url, content: page.text },
    })
    .catch(() => undefined);
  return { ...page, cached: false };
}

export async function gather(
  tenantId: string,
  def: ResearchTemplateDef,
  vars: Record<string, string>,
): Promise<GatherResult> {
  const sources: GatheredSource[] = [];
  let cacheHits = 0;

  // 1. Web search — one batch per configured query (deduped by URL). Runs every
  // configured provider (SearXNG and/or Tavily) and merges results.
  const searchHits: SearchHit[] = [];
  if (def.sources.webSearch?.enabled) {
    const seen = new Set<string>();
    const queries = (def.sources.webSearch.queries ?? []).map((q) => interpolate(q, vars)).filter(Boolean);
    const perQuery = def.fast ? 5 : 8;
    const batches = await Promise.all(queries.map((q) => aggregateWebSearch(tenantId, q, perQuery)));
    for (const hits of batches) {
      for (const h of hits as SearchHit[]) {
        const k = h.url.replace(/\/+$/, "").toLowerCase();
        if (seen.has(k)) continue;
        seen.add(k);
        searchHits.push(h);
        sources.push({ kind: "search", title: h.title, url: h.url, snippet: h.snippet });
      }
    }
  }

  // 2. Deep crawl — fetch the ACTUAL content of the most useful pages, not just
  // their search snippets. We crawl the template's seed URLs PLUS the top
  // search-result URLs (this is what turns "a list of links" into real evidence:
  // company site, Wikipedia, news, profiles…). Social/login-walled hosts are kept
  // as citations only (they don't yield readable content to a bot). Cached + capped.
  if (def.sources.crawl?.enabled || searchHits.length) {
    const maxPages = Math.min(def.sources.crawl?.maxPages ?? 8, def.fast ? 5 : 14);
    const seeds = (def.sources.crawl?.enabled ? def.sources.crawl.seeds ?? [] : [])
      .map((s) => interpolate(s, vars))
      .filter(Boolean);
    const searchUrls = searchHits.map((h) => h.url).filter((u) => !isUncrawlable(u));
    const toCrawl = dedupeUrls([...seeds, ...searchUrls]).slice(0, maxPages);
    const titleByUrl = new Map(searchHits.map((h) => [h.url.replace(/\/+$/, "").toLowerCase(), h.title]));

    const pages = await Promise.all(toCrawl.map((u) => crawlCached(tenantId, u)));
    for (const p of pages) {
      if (!p) continue;
      if (p.cached) cacheHits += 1;
      const title = p.title || titleByUrl.get(p.url.replace(/\/+$/, "").toLowerCase()) || p.url;
      sources.push({ kind: "page", title, url: p.url, content: p.text });
    }
  }

  // 3. PageSpeed — run against the first crawl seed (the main site), if enabled.
  if (def.sources.pagespeed?.enabled) {
    const firstSeed = (def.sources.crawl?.seeds ?? []).map((s) => interpolate(s, vars)).find(Boolean);
    if (firstSeed) {
      const ps = await fetchPageSpeed(firstSeed);
      if (ps) {
        sources.push({
          kind: "pagespeed",
          title: `PageSpeed: ${ps.url}`,
          url: ps.url,
          data: { performanceScore: ps.performanceScore == null ? "n/a" : String(ps.performanceScore), ...ps.metrics },
        });
      }
    }
  }

  return { sources, summary: buildSummary(sources, def.fast ? 9000 : 18000), fetchedCount: sources.length, cacheHits };
}

// Hosts that return login walls / block bots — keep as citations, don't deep-crawl.
const UNCRAWLABLE = ["linkedin.com", "twitter.com", "x.com", "facebook.com", "instagram.com", "youtube.com", "tiktok.com"];
function isUncrawlable(url: string): boolean {
  try {
    const h = new URL(url).hostname.replace(/^www\./, "");
    return UNCRAWLABLE.some((d) => h === d || h.endsWith(`.${d}`));
  } catch {
    return true;
  }
}
function dedupeUrls(urls: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of urls) {
    const k = u.replace(/\/+$/, "").toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(u);
  }
  return out;
}

// Token-aware evidence digest fed into each section prompt. Page content is the
// high-value part, so it gets the lion's share of the budget; search snippets give
// breadth + citations; PageSpeed adds site-health signal.
function buildSummary(sources: GatheredSource[], maxChars = 18000): string {
  const parts: string[] = [];
  const search = sources.filter((s) => s.kind === "search");
  const pages = sources.filter((s) => s.kind === "page" && (s.content ?? "").trim().length > 0);
  const speed = sources.filter((s) => s.kind === "pagespeed");

  if (pages.length) {
    parts.push("=== PAGE CONTENT (primary evidence — cite these) ===");
    const budget = Math.floor(maxChars * 0.8);
    const per = Math.max(900, Math.floor(budget / pages.length));
    for (const p of pages) parts.push(`### ${p.title}\n${p.url}\n${(p.content ?? "").slice(0, per)}`);
  }
  if (search.length) {
    parts.push("\n=== ADDITIONAL SEARCH RESULTS (titles + snippets) ===");
    for (const s of search.slice(0, 20)) parts.push(`- ${s.title} (${s.url}) — ${s.snippet ?? ""}`);
  }
  if (speed.length) {
    parts.push("\n=== SITE PERFORMANCE ===");
    for (const s of speed) parts.push(`- ${JSON.stringify(s.data ?? {})}`);
  }
  const out = parts.join("\n");
  return out.length > maxChars ? `${out.slice(0, maxChars)}…` : out;
}
