// Research Studio — shared types + template validation (RS-1).
//
// A ResearchTemplate is a tenant-owned, user-editable definition of *what to
// research* (subject + inputs), *which sources to gather from*, and *how the
// report is structured* (sections). Everything here is allow-listed and clamped
// before use so a stored/edited definition can never drive the engine outside
// safe bounds (source keys, section output kinds, page/query caps).

export type SubjectType = "deal" | "contact" | "company" | "freeform";

// Source catalog surfaced to the builder UI. Every source is free/self-hosted —
// the cost hint is shown next to each toggle so users see there's no per-use fee.
export const RESEARCH_SOURCE_CATALOG = [
  { key: "webSearch", label: "Web Search", cost: "free", hint: "Self-hosted SearXNG — no per-query fee", needs: "SEARXNG_URL" },
  { key: "crawl", label: "Website Crawl", cost: "free", hint: "Fetches & reads the pages you seed" },
  { key: "pagespeed", label: "Site Performance", cost: "free", hint: "Google PageSpeed Insights (free)" },
] as const;

// RS-1 supports text / table / score outputs. Charts are a later phase (RS-4) —
// kept out of the allow-list here so a template can't request an unrenderable kind.
export type SectionOutput = "text" | "table" | "score";
export const SECTION_OUTPUTS: readonly SectionOutput[] = ["text", "table", "score"];
export const SUBJECT_TYPES: readonly SubjectType[] = ["deal", "contact", "company", "freeform"];

export interface TemplateInput {
  key: string; // referenced in prompts/queries as {key}; "name" maps to the subject label
  label: string;
  prefillFrom?: string; // contextual-run hint, e.g. "company.domain" | "contact.linkedin"
  required?: boolean;
}

export interface TemplateSources {
  webSearch?: { enabled: boolean; queries?: string[] };
  crawl?: { enabled: boolean; seeds?: string[]; maxPages?: number };
  pagespeed?: { enabled: boolean };
}

export interface TemplateSection {
  id: string;
  title: string;
  prompt: string;
  outputs: SectionOutput[];
  weight?: number; // contribution to the overall score (only sections with a "score" output)
}

export interface ResearchTemplateDef {
  name: string;
  description?: string;
  subjectType: SubjectType;
  inputs: TemplateInput[];
  sources: TemplateSources;
  sections: TemplateSection[];
  fast?: boolean; // trimmed "lite" config used by the contextual Research button (RS-2)
}

// Caps — protect the gather/synthesis budget from a hand-edited template.
export const LIMITS = {
  maxQueriesPerSource: 12,
  maxSeeds: 10,
  maxPages: 20,
  maxSections: 24,
  maxInputs: 20,
} as const;

const asStr = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const asStrArr = (v: unknown, cap: number): string[] =>
  Array.isArray(v) ? v.map(asStr).filter(Boolean).slice(0, cap) : [];

// Normalize + validate an arbitrary (user-supplied) object into a safe template
// definition. Returns a cleaned def or a human-readable error. Used by both the
// save endpoint and the run-from-builtin path so nothing unvalidated reaches the engine.
export function validateTemplateDef(
  raw: unknown,
): { ok: true; def: ResearchTemplateDef } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object") return { ok: false, error: "Template must be an object" };
  const o = raw as Record<string, unknown>;

  const name = asStr(o.name);
  if (!name) return { ok: false, error: "Template name is required" };

  const subjectType = SUBJECT_TYPES.includes(o.subjectType as SubjectType)
    ? (o.subjectType as SubjectType)
    : "freeform";

  const inputsRaw = Array.isArray(o.inputs) ? o.inputs : [];
  const inputs: TemplateInput[] = inputsRaw
    .slice(0, LIMITS.maxInputs)
    .map((i): TemplateInput | null => {
      const io = (i ?? {}) as Record<string, unknown>;
      const key = asStr(io.key).replace(/[^a-zA-Z0-9_]/g, "");
      return key
        ? {
            key,
            label: asStr(io.label) || key,
            prefillFrom: asStr(io.prefillFrom) || undefined,
            required: io.required === true,
          }
        : null;
    })
    .filter((x): x is TemplateInput => x !== null);

  const so = (o.sources ?? {}) as Record<string, unknown>;
  const ws = (so.webSearch ?? {}) as Record<string, unknown>;
  const cr = (so.crawl ?? {}) as Record<string, unknown>;
  const ps = (so.pagespeed ?? {}) as Record<string, unknown>;
  const sources: TemplateSources = {
    webSearch: { enabled: ws.enabled === true, queries: asStrArr(ws.queries, LIMITS.maxQueriesPerSource) },
    crawl: {
      enabled: cr.enabled === true,
      seeds: asStrArr(cr.seeds, LIMITS.maxSeeds),
      maxPages: Math.min(Math.max(1, Number(cr.maxPages) || 5), LIMITS.maxPages),
    },
    pagespeed: { enabled: ps.enabled === true },
  };

  const sectionsRaw = Array.isArray(o.sections) ? o.sections : [];
  const sections: TemplateSection[] = sectionsRaw
    .slice(0, LIMITS.maxSections)
    .map((s, idx): TemplateSection | null => {
      const ss = (s ?? {}) as Record<string, unknown>;
      const title = asStr(ss.title);
      if (!title) return null;
      const outputs = (Array.isArray(ss.outputs) ? ss.outputs : [])
        .filter((x): x is SectionOutput => SECTION_OUTPUTS.includes(x as SectionOutput));
      return {
        id: asStr(ss.id).replace(/[^a-zA-Z0-9_]/g, "") || `section_${idx + 1}`,
        title,
        prompt: asStr(ss.prompt) || `Write the "${title}" section based on the research provided.`,
        outputs: outputs.length ? outputs : (["text"] as SectionOutput[]),
        weight: Number.isFinite(Number(ss.weight)) ? Math.max(0, Number(ss.weight)) : undefined,
      };
    })
    .filter((x): x is TemplateSection => x !== null);

  if (sections.length === 0) return { ok: false, error: "Add at least one report section" };

  const anySource =
    sources.webSearch?.enabled || sources.crawl?.enabled || sources.pagespeed?.enabled;
  if (!anySource) return { ok: false, error: "Enable at least one research source" };

  return {
    ok: true,
    def: {
      name,
      description: asStr(o.description) || undefined,
      subjectType,
      inputs,
      sources,
      sections,
      fast: o.fast === true,
    },
  };
}
