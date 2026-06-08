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
import { aiCompleteTiered, parseStructured, type AIProvider } from "../ai/intelligence";
import { chooseProvider, providerKey, type AiCredentials } from "./ai-credentials";

// Autonomous multi-round search caps — keep the agent from running away / looping.
const MAX_ROUNDS = Math.min(Math.max(1, Number(process.env.RESEARCH_MAX_ROUNDS ?? 3)), 5);
const MAX_TOTAL_QUERIES = Math.max(1, Number(process.env.RESEARCH_MAX_TOTAL_QUERIES ?? 30));
const MAX_TOTAL_PAGES = Math.max(1, Number(process.env.RESEARCH_MAX_TOTAL_PAGES ?? 24));
const norm = (u: string): string => u.replace(/\/+$/, "").toLowerCase();

export interface GatheredSource {
  kind: "search" | "page" | "pagespeed";
  title: string;
  url?: string;
  snippet?: string;
  content?: string;
  data?: Record<string, string>;
}

export interface Citation {
  n: number;
  title: string;
  url: string;
}

export interface GatherResult {
  sources: GatheredSource[];
  summary: string; // compact evidence digest for synthesis prompts (numbered [n])
  citations: Citation[]; // numbered sources the model can cite, for the Sources list
  fetchedCount: number;
  cacheHits: number; // crawled pages served from the per-tenant cache (cost saved)
  rounds: number; // how many autonomous search rounds the agent ran
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
  opts: { credentials?: AiCredentials; onProgress?: (msg: string) => void } = {},
): Promise<GatherResult> {
  const sources: GatheredSource[] = [];
  let cacheHits = 0;
  let rounds = 0;
  const ranQueries = new Set<string>(); // every query ever run (loop guard)
  const crawledKeys = new Set<string>(); // normalized URLs already crawled
  const searchKeys = new Set<string>(); // normalized URLs already in search results
  let totalQueries = 0;
  let totalPages = 0;
  const pageBudget = def.fast ? 6 : MAX_TOTAL_PAGES;

  // Deep-crawl a set of URLs (cached, SSRF-safe, budget-aware). Returns # added.
  const crawlUrls = async (urls: string[], titleByUrl?: Map<string, string>): Promise<number> => {
    const fresh = dedupeUrls(urls).filter((u) => !isUncrawlable(u) && !crawledKeys.has(norm(u)));
    const room = Math.max(0, pageBudget - totalPages);
    const picked = fresh.slice(0, Math.min(room, def.fast ? 4 : 8));
    const pages = await Promise.all(picked.map((u) => crawlCached(tenantId, u)));
    let added = 0;
    for (const p of pages) {
      if (!p) continue;
      if (p.cached) cacheHits += 1;
      crawledKeys.add(norm(p.url));
      totalPages += 1;
      added += 1;
      sources.push({ kind: "page", title: p.title || titleByUrl?.get(norm(p.url)) || p.url, url: p.url, content: p.text });
    }
    return added;
  };

  // Run a batch of queries (deduped vs. all prior rounds + budget); collect the new
  // search hits and deep-crawl the most useful of them. Returns # of new sources.
  const runQueries = async (queries: string[]): Promise<number> => {
    const toRun = queries
      .map((q) => q.trim())
      .filter((q) => q && !ranQueries.has(q.toLowerCase()))
      .slice(0, Math.max(0, MAX_TOTAL_QUERIES - totalQueries));
    if (toRun.length === 0) return 0;
    for (const q of toRun) ranQueries.add(q.toLowerCase());
    totalQueries += toRun.length;

    const perQuery = def.fast ? 5 : 8;
    const batches = await Promise.all(toRun.map((q) => aggregateWebSearch(tenantId, q, perQuery)));
    const newHits: SearchHit[] = [];
    for (const hits of batches) {
      for (const h of hits as SearchHit[]) {
        const k = norm(h.url);
        if (searchKeys.has(k)) continue;
        searchKeys.add(k);
        newHits.push(h);
        sources.push({ kind: "search", title: h.title, url: h.url, snippet: h.snippet });
      }
    }
    const titleByUrl = new Map(newHits.map((h) => [norm(h.url), h.title]));
    const crawled = await crawlUrls(newHits.map((h) => h.url), titleByUrl);
    return newHits.length + crawled;
  };

  // Round 0 — always crawl the template's seed URLs (the subject's own site).
  if (def.sources.crawl?.enabled) {
    const seeds = (def.sources.crawl.seeds ?? []).map((s) => interpolate(s, vars)).filter(Boolean);
    if (seeds.length) await crawlUrls(seeds);
  }

  // Autonomous web-search rounds: run the template's queries, then let the agent
  // decide (from what's been gathered vs. the report's needs) whether to search
  // again with targeted follow-ups — bounded by round / query / page caps.
  if (def.sources.webSearch?.enabled) {
    let queries = (def.sources.webSearch.queries ?? []).map((q) => interpolate(q, vars)).filter(Boolean);
    const provider = opts.credentials ? chooseProvider(opts.credentials) : null;
    const apiKey = provider && opts.credentials ? providerKey(opts.credentials, provider) : null;
    const canPlan = Boolean(provider && apiKey) && !def.fast; // fast/no-AI ⇒ single round

    for (let round = 1; round <= MAX_ROUNDS; round++) {
      rounds = round;
      opts.onProgress?.(round === 1 ? "Gathering sources" : `Searching deeper (round ${round})`);
      const added = await runQueries(queries);

      // Stop conditions (loop guards): last allowed round, fast mode, budgets hit,
      // no progress this round, or no AI to plan follow-ups.
      if (round >= MAX_ROUNDS || !canPlan) break;
      if (totalQueries >= MAX_TOTAL_QUERIES || totalPages >= pageBudget) break;
      if (added === 0) break;

      const plan = await planFollowups(def, vars, sources, provider as AIProvider, apiKey as string).catch(() => null);
      if (!plan || plan.sufficient || plan.queries.length === 0) break;
      const next = plan.queries.filter((q) => !ranQueries.has(q.toLowerCase()));
      if (next.length === 0) break;
      queries = next;
    }
  } else if (sources.length) {
    rounds = 1;
  }

  // PageSpeed — run against the first crawl seed (the main site), if enabled.
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

  // Number every source that has a URL so the model can cite [n] and we can render
  // a Sources list. Pages first (primary evidence), then search, then pagespeed.
  const ordered = [
    ...sources.filter((s) => s.kind === "page" && (s.content ?? "").trim().length > 0),
    ...sources.filter((s) => s.kind === "search" && s.url),
    ...sources.filter((s) => s.kind === "pagespeed"),
  ];
  const citations: Citation[] = ordered.map((s, i) => ({ n: i + 1, title: s.title || s.url || `Source ${i + 1}`, url: s.url ?? "" }));
  const numberOf = new Map(ordered.map((s, i) => [s, i + 1]));

  return {
    sources,
    summary: buildSummary(sources, numberOf, def.fast ? 9000 : 18000),
    citations,
    fetchedCount: sources.length,
    cacheHits,
    rounds,
  };
}

// Autonomous follow-up planner: the agent reviews what's been gathered against the
// report's sections and decides whether more search is needed, returning targeted
// follow-up queries for the gaps (or declaring the evidence sufficient). One cheap
// LLM call per round; any failure stops the loop (handled by the caller's .catch).
async function planFollowups(
  def: ResearchTemplateDef,
  vars: Record<string, string>,
  sources: GatheredSource[],
  provider: AIProvider,
  apiKey: string,
): Promise<{ sufficient: boolean; queries: string[] }> {
  const subject = vars.name || def.name;
  const sectionList = def.sections.map((s) => `- ${s.title}`).join("\n");
  const have = sources
    .filter((s) => s.url)
    .slice(0, 40)
    .map((s) => `- ${s.title}${s.snippet ? `: ${s.snippet.slice(0, 120)}` : s.content ? `: ${s.content.slice(0, 120)}` : ""}`)
    .join("\n");
  const prompt = `Research subject: ${subject}

The final report must cover these sections:
${sectionList}

Evidence gathered so far (${sources.length} sources):
${have || "(nothing yet)"}

Decide if this evidence is ENOUGH to write every section with specific, sourced facts. If important gaps remain, propose up to 6 NEW, specific web-search queries targeting ONLY the missing information — do NOT repeat topics already covered, and prefer queries that surface recent, factual, primary sources.

Return ONLY JSON: { "sufficient": boolean, "queries": ["...", ...] }. If it's sufficient, return an empty queries array.`;
  const text = await aiCompleteTiered(prompt, {
    provider,
    tier: "cheap",
    apiKey,
    system: "You are a meticulous research planner. Be decisive, avoid redundant queries, and stop when the evidence is adequate.",
    maxTokens: 500,
  });
  const parsed = parseStructured<{ sufficient: boolean; queries?: unknown }>(text, ["sufficient"]);
  const queries = Array.isArray(parsed.queries)
    ? parsed.queries.map((q) => String(q).trim()).filter(Boolean).slice(0, 6)
    : [];
  return { sufficient: parsed.sufficient === true, queries };
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

// Token-aware evidence digest fed into each section prompt. Each source is labelled
// with its citation number [n] so the model can cite claims precisely. Page content
// is the high-value part and gets the lion's share of the budget.
function buildSummary(sources: GatheredSource[], numberOf: Map<GatheredSource, number>, maxChars = 18000): string {
  const parts: string[] = [];
  const search = sources.filter((s) => s.kind === "search" && s.url);
  const pages = sources.filter((s) => s.kind === "page" && (s.content ?? "").trim().length > 0);
  const speed = sources.filter((s) => s.kind === "pagespeed");

  if (pages.length) {
    parts.push("=== PAGE CONTENT (primary evidence — cite by [number]) ===");
    const budget = Math.floor(maxChars * 0.8);
    const per = Math.max(900, Math.floor(budget / pages.length));
    for (const p of pages) parts.push(`[${numberOf.get(p)}] ${p.title} — ${p.url}\n${(p.content ?? "").slice(0, per)}`);
  }
  if (search.length) {
    parts.push("\n=== ADDITIONAL SEARCH RESULTS (titles + snippets) ===");
    for (const s of search.slice(0, 20)) parts.push(`[${numberOf.get(s)}] ${s.title} — ${s.url}\n${s.snippet ?? ""}`);
  }
  if (speed.length) {
    parts.push("\n=== SITE PERFORMANCE ===");
    for (const s of speed) parts.push(`[${numberOf.get(s)}] ${JSON.stringify(s.data ?? {})}`);
  }
  const out = parts.join("\n");
  return out.length > maxChars ? `${out.slice(0, maxChars)}…` : out;
}
