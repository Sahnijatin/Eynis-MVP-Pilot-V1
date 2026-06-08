// Synthesis layer (RS-1). Turns gathered evidence into the structured report
// sections defined by the template. This is the ONLY paid step — it uses the
// tiered AI helper (premium model with thinking for the final structuring), and
// degrades to a deterministic, evidence-grounded fallback when no AI key is
// configured (mirrors the platform's keyword-fallback philosophy so dev/test and
// unconfigured tenants still get a complete report).

import { aiCompleteTiered, parseStructured, type AIProvider } from "../ai/intelligence";
import type { ResearchTemplateDef, TemplateSection } from "./types";
import type { GatherResult } from "./gather";
import type { AiCredentials } from "./ai-credentials";

// Pick the synthesis provider from the resolved credentials: an explicit
// RESEARCH_AI_PROVIDER wins (if that provider's key exists), else prefer Claude when
// available, else OpenAI. So a tenant/deploy with only an OpenAI key uses OpenAI.
function chooseProvider(creds: AiCredentials): AIProvider {
  const pref = process.env.RESEARCH_AI_PROVIDER?.trim().toLowerCase();
  if (pref === "openai" && creds.openaiKey) return "openai";
  if (pref === "claude" && creds.anthropicKey) return "claude";
  return creds.anthropicKey ? "claude" : "openai";
}

export interface SynthTable {
  headers: string[];
  rows: string[][];
}
export interface SynthSection {
  id: string;
  title: string;
  content: string;
  table: SynthTable | null;
  score: number | null;
}
export interface SynthResult {
  sections: SynthSection[];
  score: number | null;
  usage: { provider: string; llmCalls: number; usedAI: boolean; sourcesFetched: number };
}

const SYSTEM = `You are a senior B2B research analyst writing one section of an executive-grade account/competitor/prospect brief that a CXO, CIO, or revenue leader will read to make a decision.

Standards:
- Be specific and quantitative. Pull out real figures (revenue, headcount, funding amounts, growth %, pricing, dates, locations, named people and their titles, products, customers, partners) from the evidence — not vague generalities.
- Lead with what matters most; within anything time-based, put the MOST RECENT first and include the date/period (e.g. "Mar 2026:").
- Cite as you go: reference the source inline in parentheses (e.g. "(Wikipedia)", "(company site)", "(Crunchbase)") so claims are traceable.
- Use a compact Markdown table when the content is structured (facts, comparisons, people, metrics, timelines). Prose for narrative/analysis.
- Be decision-useful: call out implications, not just facts. Where the evidence is thin or silent, say so explicitly — never invent specifics, numbers, names, or quotes that aren't supported.
- Write tightly and professionally. No filler, no hedging boilerplate.`;

const SYNTH_CONCURRENCY = Math.max(1, Number(process.env.RESEARCH_SYNTH_CONCURRENCY ?? 3));

// Run an async mapper over items with a fixed concurrency, preserving input order.
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) break;
      results[i] = await fn(items[i] as T);
    }
  });
  await Promise.all(workers);
  return results;
}

const clampScore = (v: unknown): number | null => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : null;
};

function sanitizeTable(raw: unknown): SynthTable | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as { headers?: unknown; rows?: unknown };
  const headers = Array.isArray(o.headers) ? o.headers.map((h) => String(h)).slice(0, 8) : [];
  const rows = Array.isArray(o.rows)
    ? o.rows
        .filter((r) => Array.isArray(r))
        .map((r) => (r as unknown[]).map((c) => String(c ?? "")).slice(0, 8))
        .slice(0, 40)
    : [];
  if (headers.length === 0 && rows.length === 0) return null;
  return { headers, rows };
}

function sectionPrompt(def: ResearchTemplateDef, section: TemplateSection, subject: string, evidence: string): string {
  const wants: string[] = ['"content": a detailed, specific written section in Markdown (use **bold** labels and bullet lists where helpful)'];
  if (section.outputs.includes("table")) wants.push('"table": { "headers": [...], "rows": [[...], ...] } — a structured table of the concrete facts for this section (or null if genuinely not applicable)');
  if (section.outputs.includes("score")) wants.push('"score": an integer 0-100 with the one-line justification folded into "content" (or null)');
  return `SUBJECT: ${subject || "(unspecified)"}
REPORT TYPE: ${def.name}
SECTION: ${section.title}
WHAT TO PRODUCE: ${section.prompt}

Write this section to an executive standard: extract every relevant specific from the evidence (numbers, names+titles, dates, products, customers, competitors, funding), most-recent-first where time-based, with inline source citations. If the evidence doesn't cover something important, note the gap rather than guessing.

Return ONLY a JSON object with these keys:
{ ${wants.join(", ")} }

EVIDENCE (your only source of facts — do not fabricate beyond it):
${evidence || "(no external evidence was gathered — state what cannot be determined without it)"}`;
}

// Deterministic fallback for one section when AI is unavailable or errors out.
function fallbackSection(section: TemplateSection, gathered: GatherResult): SynthSection {
  const top = gathered.sources
    .filter((s) => s.kind === "search" || s.kind === "page")
    .slice(0, 5)
    .map((s) => `- ${s.title}${s.url ? ` (${s.url})` : ""}`)
    .join("\n");
  const content = gathered.fetchedCount
    ? `AI synthesis is not configured, so this section summarises the raw evidence gathered (${gathered.fetchedCount} source${gathered.fetchedCount === 1 ? "" : "s"}).\n\n${top}`
    : "No evidence was gathered and AI synthesis is not configured for this workspace.";
  let score: number | null = null;
  if (section.outputs.includes("score")) {
    const ps = gathered.sources.find((s) => s.kind === "pagespeed")?.data?.performanceScore;
    const psNum = ps && ps !== "n/a" ? Number(ps) : null;
    score = psNum != null ? psNum : Math.min(100, gathered.fetchedCount * 12);
  }
  return { id: section.id, title: section.title, content, table: null, score };
}

export async function synthesize(
  def: ResearchTemplateDef,
  subject: string,
  gathered: GatherResult,
  opts: { provider?: AIProvider; tier?: "cheap" | "premium"; credentials?: AiCredentials } = {},
): Promise<SynthResult> {
  // Effective AI keys: tenant credentials (from Integrations) if passed, else env.
  const creds: AiCredentials = opts.credentials ?? {
    openaiKey: process.env.OPENAI_API_KEY?.trim() || null,
    anthropicKey: process.env.ANTHROPIC_API_KEY?.trim() || null,
  };
  const anyAI = Boolean(creds.openaiKey || creds.anthropicKey);
  const provider = opts.provider ?? chooseProvider(creds);
  const apiKey = (provider === "openai" ? creds.openaiKey : creds.anthropicKey) ?? undefined;
  // "fast" templates (the contextual lite button) always use the cheap tier.
  const tier = opts.tier ?? (def.fast ? "cheap" : "premium");
  let llmCalls = 0;

  const synthOne = async (section: TemplateSection): Promise<SynthSection> => {
    if (!anyAI) return fallbackSection(section, gathered);
    try {
      const text = await aiCompleteTiered(sectionPrompt(def, section, subject, gathered.summary), {
        provider,
        tier,
        system: SYSTEM,
        apiKey,
        maxTokens: tier === "cheap" ? 1600 : 4000,
      });
      llmCalls += 1;
      const parsed = parseStructured<{ content: string; table?: unknown; score?: unknown }>(text, ["content"]);
      return {
        id: section.id,
        title: section.title,
        content: String(parsed.content).trim() || "(no content)",
        table: section.outputs.includes("table") ? sanitizeTable(parsed.table) : null,
        score: section.outputs.includes("score") ? clampScore(parsed.score) : null,
      };
    } catch {
      // One bad section never fails the whole report — fall back for just this one.
      return fallbackSection(section, gathered);
    }
  };

  // Synthesize sections with bounded concurrency (these reports have many sections;
  // sequential calls would make a run minutes-long). Order is preserved.
  const sections = await mapWithConcurrency(def.sections, SYNTH_CONCURRENCY, synthOne);

  // Overall score = weighted average of sections that produced a score.
  const scored = sections
    .map((s, i) => ({ score: s.score, weight: def.sections[i]?.weight ?? 1 }))
    .filter((x): x is { score: number; weight: number } => typeof x.score === "number");
  const totalWeight = scored.reduce((a, x) => a + (x.weight || 1), 0);
  const score = scored.length
    ? Math.round(scored.reduce((a, x) => a + x.score * (x.weight || 1), 0) / (totalWeight || 1))
    : null;

  return {
    sections,
    score,
    usage: { provider, llmCalls, usedAI: anyAI && llmCalls > 0, sourcesFetched: gathered.fetchedCount },
  };
}
