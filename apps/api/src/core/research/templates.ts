// Built-in starter templates (RS-1). These ship with the module and are always
// available to every tenant without seeding — GET /research/templates merges them
// with the tenant's own saved templates. They carry stable "builtin:" ids. Editing
// a built-in in the UI clones it into a real (DB) template; the originals are
// read-only. Industry-agnostic by design (CLAUDE.md principle #1).

import type { ResearchTemplateDef } from "./types";

export const BUILTIN_PREFIX = "builtin:";

export interface BuiltinTemplate {
  id: string; // "builtin:<slug>"
  def: ResearchTemplateDef;
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: "builtin:pre-call-deal-brief",
    def: {
      name: "Pre-Call Deal Brief",
      description: "A tight briefing to read before a sales call — who they are, recent signals, and how to approach.",
      subjectType: "deal",
      fast: false,
      inputs: [
        { key: "name", label: "Company / prospect name", required: true },
        { key: "website", label: "Website URL", prefillFrom: "company.domain" },
        { key: "linkedin", label: "LinkedIn", prefillFrom: "contact.linkedin" },
      ],
      sources: {
        webSearch: { enabled: true, queries: ["{name} news", "{name} funding", "{name} competitors", "{name} reviews"] },
        crawl: { enabled: true, seeds: ["{website}"], maxPages: 6 },
        pagespeed: { enabled: false },
      },
      sections: [
        { id: "overview", title: "Company Overview", prompt: "Summarise who {name} is, what they sell, their market and likely size, using the research.", outputs: ["text"] },
        { id: "signals", title: "Recent Signals", prompt: "List notable recent news, funding, launches, hiring or risk signals about {name}.", outputs: ["text", "table"] },
        { id: "swot", title: "SWOT", prompt: "Give a concise SWOT for {name} grounded in the evidence.", outputs: ["table"] },
        { id: "talktrack", title: "Recommended Talk Track", prompt: "Recommend a talk track: angle, value hypothesis, 3 discovery questions, and likely objections.", outputs: ["text"] },
        { id: "fit", title: "Fit Score", prompt: "Score how strong a fit this prospect looks (0-100) and justify in one line.", outputs: ["score"], weight: 100 },
      ],
    },
  },
  {
    id: "builtin:competitor-teardown",
    def: {
      name: "Competitor Teardown",
      description: "Positioning, pricing signals, strengths and gaps for a competitor — and where to win.",
      subjectType: "company",
      fast: false,
      inputs: [
        { key: "name", label: "Competitor name", required: true },
        { key: "website", label: "Website URL", prefillFrom: "company.domain" },
      ],
      sources: {
        webSearch: { enabled: true, queries: ["{name} pricing", "{name} reviews", "{name} vs", "{name} features"] },
        crawl: { enabled: true, seeds: ["{website}"], maxPages: 8 },
        pagespeed: { enabled: true },
      },
      sections: [
        { id: "positioning", title: "Positioning & Messaging", prompt: "Describe how {name} positions itself: target audience, core message, and proof points.", outputs: ["text"] },
        { id: "pricing", title: "Pricing Signals", prompt: "Summarise any pricing/packaging signals found for {name}.", outputs: ["text", "table"] },
        { id: "strengths_gaps", title: "Strengths & Gaps", prompt: "List {name}'s apparent strengths and gaps based on the evidence.", outputs: ["table"] },
        { id: "opportunities", title: "Where to Win", prompt: "Recommend where a competitor could win against {name}, with concrete angles.", outputs: ["text"] },
        { id: "score", title: "Threat Level", prompt: "Rate {name}'s competitive threat (0-100) and justify briefly.", outputs: ["score"], weight: 100 },
      ],
    },
  },
  {
    id: "builtin:company-profile",
    def: {
      name: "Company / Prospect Profile",
      description: "A general-purpose profile: firmographics, footprint, buying signals and a fit score.",
      subjectType: "company",
      fast: false,
      inputs: [
        { key: "name", label: "Company name", required: true },
        { key: "website", label: "Website URL", prefillFrom: "company.domain" },
      ],
      sources: {
        webSearch: { enabled: true, queries: ["{name} company", "{name} industry", "{name} news"] },
        crawl: { enabled: true, seeds: ["{website}"], maxPages: 5 },
        pagespeed: { enabled: false },
      },
      sections: [
        { id: "firmographics", title: "Firmographics", prompt: "Summarise {name}'s industry, size, geography and business model from the research.", outputs: ["text", "table"] },
        { id: "footprint", title: "Digital Footprint", prompt: "Describe {name}'s online footprint and what it suggests about their maturity.", outputs: ["text"] },
        { id: "signals", title: "Buying Signals", prompt: "Identify any buying signals or triggers relevant to outreach.", outputs: ["text"] },
        { id: "fit", title: "Fit Score", prompt: "Score overall fit (0-100) and justify in one line.", outputs: ["score"], weight: 100 },
      ],
    },
  },
  {
    id: "builtin:marketing-audit",
    def: {
      name: "Marketing Audit",
      description: "The classic end-to-end marketing audit: snapshot, SWOT, channels and a 90-day plan.",
      subjectType: "freeform",
      fast: false,
      inputs: [
        { key: "name", label: "Business name", required: true },
        { key: "website", label: "Website URL" },
        { key: "industry", label: "Industry" },
      ],
      sources: {
        webSearch: { enabled: true, queries: ["{name} {industry}", "{industry} marketing trends", "{name} competitors"] },
        crawl: { enabled: true, seeds: ["{website}"], maxPages: 8 },
        pagespeed: { enabled: true },
      },
      sections: [
        { id: "summary", title: "Executive Summary", prompt: "Write an executive summary of {name}'s marketing strengths, weaknesses, opportunities and threats.", outputs: ["text"] },
        { id: "snapshot", title: "Business Snapshot", prompt: "Summarise {name}'s digital presence and baseline KPIs as a snapshot.", outputs: ["text", "table"] },
        { id: "swot", title: "SWOT & Key Findings", prompt: "Perform a SWOT analysis for {name} based on the research.", outputs: ["table"] },
        { id: "channels", title: "Channel Recommendations", prompt: "Recommend marketing channels and tactics for {name} with rationale.", outputs: ["text", "table"] },
        { id: "plan", title: "90-Day Plan", prompt: "Give a prioritised 90-day execution plan for {name}.", outputs: ["text"] },
        { id: "score", title: "Marketing Health Score", prompt: "Score {name}'s marketing health (0-100) and justify briefly.", outputs: ["score"], weight: 100 },
      ],
    },
  },
];

export const getBuiltinTemplate = (id: string): BuiltinTemplate | undefined =>
  BUILTIN_TEMPLATES.find((t) => t.id === id);

export const isBuiltinId = (id: string): boolean => id.startsWith(BUILTIN_PREFIX);
