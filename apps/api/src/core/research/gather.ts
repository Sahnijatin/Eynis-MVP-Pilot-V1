// Gather layer (RS-1). Runs the enabled, self-hosted sources for a template and
// returns structured evidence plus a compact text summary used by synthesis.
// Cost profile: SearXNG + crawl + PageSpeed are all free/self-hosted, and crawled
// pages are cached per-tenant (ResearchSourceCache) so repeat runs don't re-fetch.

import { createHash } from "node:crypto";
import { prisma } from "../../db/prisma";
import type { ResearchTemplateDef } from "./types";
import { webSearch, type SearchHit } from "./sources/searxng";
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
}

// Replace {key} tokens in a string from the resolved inputs (plus {name} = subject).
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (vars[k] ?? "").trim());
}

const CACHE_TTL_MS = Number(process.env.RESEARCH_CACHE_TTL_MS ?? 7 * 24 * 60 * 60 * 1000); // 7d
const urlHash = (url: string): string => createHash("sha256").update(url.toLowerCase()).digest("hex");

// Crawl a URL through the per-tenant cache. A fresh hit is reused; otherwise we
// fetch, store, and return. Cache misses/failures never throw.
async function crawlCached(tenantId: string, url: string): Promise<{ url: string; title: string; text: string } | null> {
  const hash = urlHash(url);
  const cached = await prisma.researchSourceCache
    .findUnique({ where: { tenantId_urlHash: { tenantId, urlHash: hash } } })
    .catch(() => null);
  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    return { url: cached.url, title: "", text: cached.content };
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
  return page;
}

export async function gather(
  tenantId: string,
  def: ResearchTemplateDef,
  vars: Record<string, string>,
): Promise<GatherResult> {
  const sources: GatheredSource[] = [];

  // 1. Web search — one batch per configured query (deduped by URL).
  if (def.sources.webSearch?.enabled) {
    const seen = new Set<string>();
    const queries = (def.sources.webSearch.queries ?? []).map((q) => interpolate(q, vars)).filter(Boolean);
    const perQuery = def.fast ? 4 : 6;
    const batches = await Promise.all(queries.map((q) => webSearch(q, perQuery)));
    for (const hits of batches) {
      for (const h of hits as SearchHit[]) {
        if (seen.has(h.url)) continue;
        seen.add(h.url);
        sources.push({ kind: "search", title: h.title, url: h.url, snippet: h.snippet });
      }
    }
  }

  // 2. Crawl — seed URLs (cached). Capped by the template's maxPages.
  if (def.sources.crawl?.enabled) {
    const maxPages = Math.min(def.sources.crawl.maxPages ?? 5, def.fast ? 3 : 10);
    const seeds = (def.sources.crawl.seeds ?? [])
      .map((s) => interpolate(s, vars))
      .filter(Boolean)
      .slice(0, maxPages);
    const pages = await Promise.all(seeds.map((s) => crawlCached(tenantId, s)));
    for (const p of pages) {
      if (p) sources.push({ kind: "page", title: p.title || p.url, url: p.url, content: p.text });
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

  return { sources, summary: buildSummary(sources), fetchedCount: sources.length };
}

// Compact, token-aware digest of everything gathered, fed into each section prompt.
function buildSummary(sources: GatheredSource[], maxChars = 6000): string {
  const parts: string[] = [];
  const search = sources.filter((s) => s.kind === "search");
  const pages = sources.filter((s) => s.kind === "page");
  const speed = sources.filter((s) => s.kind === "pagespeed");

  if (search.length) {
    parts.push("WEB SEARCH RESULTS:");
    for (const s of search.slice(0, 12)) parts.push(`- ${s.title} (${s.url})\n  ${s.snippet ?? ""}`);
  }
  if (pages.length) {
    parts.push("\nPAGE CONTENT:");
    const per = Math.max(600, Math.floor(3500 / pages.length));
    for (const p of pages) parts.push(`- ${p.title} (${p.url})\n  ${(p.content ?? "").slice(0, per)}`);
  }
  if (speed.length) {
    parts.push("\nSITE PERFORMANCE:");
    for (const s of speed) parts.push(`- ${JSON.stringify(s.data ?? {})}`);
  }
  const out = parts.join("\n");
  return out.length > maxChars ? `${out.slice(0, maxChars)}…` : out;
}
