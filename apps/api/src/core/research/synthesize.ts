// Synthesis layer (RS-1). Turns gathered evidence into the structured report
// sections defined by the template. This is the ONLY paid step — it uses the
// tiered AI helper (premium model with thinking for the final structuring), and
// degrades to a deterministic, evidence-grounded fallback when no AI key is
// configured (mirrors the platform's keyword-fallback philosophy so dev/test and
// unconfigured tenants still get a complete report).

import {
  aiCompleteTiered,
  parseStructured,
  AI_AVAILABLE,
  CLAUDE_AVAILABLE,
  OPENAI_AVAILABLE,
  type AIProvider,
} from "../ai/intelligence";

// Pick the synthesis provider: an explicit RESEARCH_AI_PROVIDER wins (if its key is
// set), otherwise prefer Claude when available, else OpenAI. This way a deployment
// with ONLY OPENAI_API_KEY uses OpenAI instead of silently falling back.
function defaultResearchProvider(): AIProvider {
  const pref = process.env.RESEARCH_AI_PROVIDER?.trim().toLowerCase();
  if (pref === "openai" && OPENAI_AVAILABLE) return "openai";
  if (pref === "claude" && CLAUDE_AVAILABLE) return "claude";
  return CLAUDE_AVAILABLE ? "claude" : "openai";
}
import type { ResearchTemplateDef, TemplateSection } from "./types";
import type { GatherResult } from "./gather";

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

const SYSTEM = `You are a research analyst producing one section of a business research report.
Ground every claim in the evidence provided. Do not invent specific numbers, names, or quotes that are not supported by the evidence — if something is unknown, say so. Be concise and useful.`;

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
        .slice(0, 30)
    : [];
  if (headers.length === 0 && rows.length === 0) return null;
  return { headers, rows };
}

function sectionPrompt(def: ResearchTemplateDef, section: TemplateSection, subject: string, evidence: string): string {
  const wants: string[] = ['"content": a clear written section (markdown allowed)'];
  if (section.outputs.includes("table")) wants.push('"table": { "headers": [...], "rows": [[...], ...] } (or null if not applicable)');
  if (section.outputs.includes("score")) wants.push('"score": an integer 0-100 (or null if not applicable)');
  return `Report subject: ${subject || "(unspecified)"}
Report type: ${def.name}
Section: ${section.title}
Instruction: ${section.prompt}

Return a JSON object with these keys:
{ ${wants.join(", ")} }

EVIDENCE (use only this; do not fabricate beyond it):
${evidence || "(no external evidence was gathered — say what cannot be determined)"}`;
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
  opts: { provider?: AIProvider; tier?: "cheap" | "premium" } = {},
): Promise<SynthResult> {
  const provider = opts.provider ?? defaultResearchProvider();
  // "fast" templates (the contextual lite button) always use the cheap tier.
  const tier = opts.tier ?? (def.fast ? "cheap" : "premium");
  const sections: SynthSection[] = [];
  let llmCalls = 0;

  for (const section of def.sections) {
    if (!AI_AVAILABLE) {
      sections.push(fallbackSection(section, gathered));
      continue;
    }
    try {
      const text = await aiCompleteTiered(sectionPrompt(def, section, subject, gathered.summary), {
        provider,
        tier,
        system: SYSTEM,
        maxTokens: tier === "cheap" ? 1200 : 2400,
      });
      llmCalls += 1;
      const parsed = parseStructured<{ content: string; table?: unknown; score?: unknown }>(text, ["content"]);
      sections.push({
        id: section.id,
        title: section.title,
        content: String(parsed.content).trim() || "(no content)",
        table: section.outputs.includes("table") ? sanitizeTable(parsed.table) : null,
        score: section.outputs.includes("score") ? clampScore(parsed.score) : null,
      });
    } catch {
      // One bad section never fails the whole report — fall back for just this one.
      sections.push(fallbackSection(section, gathered));
    }
  }

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
    usage: { provider, llmCalls, usedAI: AI_AVAILABLE && llmCalls > 0, sourcesFetched: gathered.fetchedCount },
  };
}
