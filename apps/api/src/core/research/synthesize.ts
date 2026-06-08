// Synthesis layer (RS-1). Turns gathered evidence into the structured report
// sections defined by the template. This is the ONLY paid step — it uses the
// tiered AI helper (premium model with thinking for the final structuring), and
// degrades to a deterministic, evidence-grounded fallback when no AI key is
// configured (mirrors the platform's keyword-fallback philosophy so dev/test and
// unconfigured tenants still get a complete report).

import { aiCompleteTiered, parseStructured, type AIProvider } from "../ai/intelligence";
import type { ResearchTemplateDef, TemplateSection } from "./types";
import type { GatherResult, Citation } from "./gather";
import { chooseProvider, type AiCredentials } from "./ai-credentials";

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
  sources: Citation[]; // numbered sources for the report's Sources list
  usage: { provider: string; llmCalls: number; usedAI: boolean; sourcesFetched: number };
}

const TODAY = new Date().toISOString().slice(0, 10);

const SYSTEM = `You are a senior B2B research analyst writing one section of an executive-grade account/competitor/prospect brief that a CXO/CIO/revenue leader will act on. Today is ${TODAY}.

ABSOLUTE GROUNDING RULES (a wrong "fact" is worse than a missing one):
- Use ONLY the EVIDENCE provided in this prompt. Do NOT use your own training/prior knowledge about the subject — it may be outdated, or about a DIFFERENT entity that shares the name. If the evidence doesn't establish something, you do not know it.
- NEVER invent or guess specific people, names, titles, customers, partners, numbers, revenue, dates, quotes, or events. State a specific ONLY if it appears in the evidence.
- Every specific claim must end with its source number(s) in brackets, e.g. "Revenue was $13.3B [2]." If you cannot cite it, do not write it.
- If a source could not be read (e.g. a LinkedIn/profile page that returned no usable content), say "profile could not be accessed" and describe the ROLE generically — do NOT guess who the person is or fabricate their background.
- If the evidence is thin or silent on a section, say so plainly ("The available sources don't cover X.") and keep the section short. It is correct and expected to say "Not found in the available sources."

STYLE:
- Specific and quantitative where (and only where) the evidence supports it; most-recent-first for anything time-based, with the date.
- Use a compact Markdown table for structured facts/comparisons/people/metrics; prose for analysis.
- Call out implications, not just facts. Tight and professional — no filler.`;

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

function inputsBlock(inputs: Record<string, string>): string {
  const entries = Object.entries(inputs).filter(([, v]) => v && v.trim());
  if (entries.length === 0) return "";
  return `PROVIDED INPUTS (identifiers the user gave — use these to know WHICH entity this is; do not infer facts about a person/company beyond what the EVIDENCE shows):\n${entries.map(([k, v]) => `- ${k}: ${v}`).join("\n")}\n\n`;
}

function sectionPrompt(def: ResearchTemplateDef, section: TemplateSection, subject: string, evidence: string, inputs: Record<string, string>): string {
  const wants: string[] = ['"content": a detailed, specific Markdown section. Cite every specific with bracketed source numbers, e.g. [2]. (use **bold** labels and bullet lists where helpful)'];
  if (section.outputs.includes("table")) wants.push('"table": { "headers": [...], "rows": [[...], ...] } — a table of the concrete, cited facts for this section (or null if the evidence doesn\'t support one)');
  if (section.outputs.includes("score")) wants.push('"score": an integer 0-100 with the one-line justification folded into "content" (or null if the evidence is too thin to score)');
  return `SUBJECT: ${subject || "(unspecified)"}
REPORT TYPE: ${def.name}
SECTION: ${section.title}
WHAT TO PRODUCE: ${section.prompt}

${inputsBlock(inputs)}Write to an executive standard using ONLY the evidence below. Extract real specifics (numbers, names+titles, dates, products, customers, competitors, funding) and cite each with its [number]. Most-recent-first where time-based. If the evidence doesn't cover something, write that it was not found — never fill gaps with guesses or prior knowledge.

Return ONLY a JSON object with these keys:
{ ${wants.join(", ")} }

EVIDENCE (your ONLY source of facts — each item is prefixed with its citation [number]):
${evidence || "(No external evidence was gathered. Do not invent anything — state that the report could not be produced without sources.)"}`;
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
  opts: { provider?: AIProvider; tier?: "cheap" | "premium"; credentials?: AiCredentials; inputs?: Record<string, string> } = {},
): Promise<SynthResult> {
  const inputs = opts.inputs ?? {};
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
      const text = await aiCompleteTiered(sectionPrompt(def, section, subject, gathered.summary, inputs), {
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
    sources: gathered.citations,
    usage: { provider, llmCalls, usedAI: anyAI && llmCalls > 0, sourcesFetched: gathered.fetchedCount },
  };
}
