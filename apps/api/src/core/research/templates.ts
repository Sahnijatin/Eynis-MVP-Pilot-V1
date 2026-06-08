// Built-in starter templates. These ship with the module and are always available
// to every tenant without seeding — GET /research/templates merges them with the
// tenant's own saved templates. Stable "builtin:" ids; editing one in the UI clones
// it to a real (DB) template. Industry-agnostic (CLAUDE.md principle #1).
//
// They are deliberately COMPREHENSIVE: lots of targeted search queries (→ more pages
// crawled → richer evidence) and a full, importance-ordered set of sections so the
// generated report reads like an executive-grade B2B brief. Sections are ordered by
// what a CXO/revenue leader wants first; time-based sections instruct recent-first.

import type { ResearchTemplateDef } from "./types";

export const BUILTIN_PREFIX = "builtin:";

export interface BuiltinTemplate {
  id: string; // "builtin:<slug>"
  def: ResearchTemplateDef;
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: "builtin:company-profile",
    def: {
      name: "Company / Prospect Profile",
      description: "A full executive brief on a company: snapshot, recent developments, leadership, financials, competitors, buying signals and a fit score.",
      subjectType: "company",
      fast: false,
      inputs: [
        { key: "name", label: "Company name", required: true },
        { key: "website", label: "Website URL", prefillFrom: "company.domain" },
        { key: "industry", label: "Industry (optional)" },
      ],
      sources: {
        webSearch: {
          enabled: true,
          queries: [
            "{name} company overview",
            "{name} wikipedia",
            "{name} revenue employees headcount",
            "{name} funding investors valuation",
            "{name} CEO leadership team executives",
            "{name} latest news announcement",
            "{name} competitors alternatives",
            "{name} customers case studies",
            "{name} acquisitions partnerships",
            "{name} products pricing",
          ],
        },
        crawl: { enabled: true, seeds: ["{website}"], maxPages: 14 },
        pagespeed: { enabled: true },
      },
      sections: [
        { id: "exec_summary", title: "Executive Summary", prompt: "In 4-6 sentences, give the decision-maker's TL;DR on {name}: what they do, scale, momentum, why they matter, and the single most important takeaway. Lead with the headline.", outputs: ["text"] },
        { id: "snapshot", title: "Company Snapshot", prompt: "Build a fact table for {name}: founded, HQ/locations, public/private (+ ticker if public), ownership, employee count, estimated revenue, industry/sub-sector, website. Add 2-3 lines of context below the table.", outputs: ["table", "text"] },
        { id: "recent", title: "Recent Developments (last ~12 months)", prompt: "List notable recent events for {name} — funding, M&A, product launches, exec hires/departures, expansions, partnerships, incidents — MOST RECENT FIRST, each with its date and a one-line 'so what'. Use a table (Date | Event | Why it matters).", outputs: ["table", "text"] },
        { id: "leadership", title: "Leadership & Key Decision-Makers", prompt: "Identify the key people at {name} (CEO, founders, and relevant CxO/VP buyers) as a table: Name | Title | Notes. Flag who a seller would likely engage.", outputs: ["table"] },
        { id: "offering", title: "Products, Services & Value Proposition", prompt: "Describe {name}'s main products/services, who they're for, and the core value proposition / positioning. Note any pricing or packaging signals found.", outputs: ["text"] },
        { id: "market", title: "Market Position & Competitive Landscape", prompt: "Summarise {name}'s market and position, then a competitor table (Competitor | How they compare). Note differentiation and any market-share/segment signals.", outputs: ["text", "table"] },
        { id: "financials", title: "Financials & Funding", prompt: "Summarise what's known about {name}'s financials: revenue and growth, profitability signals, and funding history (rounds, amounts, dates, lead investors) as a table. Note confidence/estimates where figures are inferred.", outputs: ["table", "text"] },
        { id: "customers", title: "Customers & Partnerships", prompt: "Notable customers, logos, case studies and strategic partnerships for {name}, with what they signal about target segment and traction.", outputs: ["text"] },
        { id: "tech", title: "Technology & Digital Footprint", prompt: "Assess {name}'s digital footprint and (using the site performance data) web/tech maturity — what it suggests about sophistication and any gaps.", outputs: ["text"] },
        { id: "signals", title: "Buying Signals & Triggers", prompt: "Identify concrete buying signals / triggers relevant to outreach (hiring surges, expansion, leadership change, funding, pain points, tech adoption). Rank by strength.", outputs: ["text"] },
        { id: "risks", title: "Risks & Watch-outs", prompt: "Risks, red flags or watch-outs about {name} (financial, reputational, competitive, organisational).", outputs: ["text"] },
        { id: "engagement", title: "Recommended Engagement Strategy", prompt: "Recommend how to approach {name}: who to target, the value hypothesis, the angle/hook, and a concrete first next step.", outputs: ["text"] },
        { id: "fit", title: "Overall Fit Score", prompt: "Give an overall opportunity/fit score (0-100) for {name} as a prospect, with a one-line justification of the main drivers.", outputs: ["score"], weight: 100 },
      ],
    },
  },
  {
    id: "builtin:pre-call-deal-brief",
    def: {
      name: "Pre-Call Deal Brief",
      description: "A tight, sales-ready briefing to read before a call — who they are, recent triggers, the buying committee, value hypothesis, discovery questions and objections.",
      subjectType: "deal",
      fast: false,
      inputs: [
        { key: "name", label: "Company / prospect name", required: true },
        { key: "website", label: "Website URL", prefillFrom: "company.domain" },
        { key: "linkedin", label: "LinkedIn (optional)", prefillFrom: "contact.linkedin" },
      ],
      sources: {
        webSearch: {
          enabled: true,
          queries: [
            "{name} company overview",
            "{name} latest news announcement",
            "{name} funding revenue employees",
            "{name} leadership executives CxO",
            "{name} competitors alternatives",
            "{name} customers case studies",
            "{name} hiring jobs",
            "{name} strategy priorities",
          ],
        },
        crawl: { enabled: true, seeds: ["{website}"], maxPages: 12 },
        pagespeed: { enabled: false },
      },
      sections: [
        { id: "exec_summary", title: "Executive Summary", prompt: "4-6 sentence pre-call TL;DR on {name}: who they are, why now, and the single best angle for this conversation.", outputs: ["text"] },
        { id: "snapshot", title: "Company Snapshot", prompt: "Fact table for {name}: industry, size (employees), estimated revenue, HQ, funding/ownership, website.", outputs: ["table"] },
        { id: "triggers", title: "Recent Triggers & News", prompt: "Recent events that create a reason to engage {name} NOW — most recent first, dated, as a table (Date | Trigger | Sales relevance).", outputs: ["table", "text"] },
        { id: "stakeholders", title: "Buying Committee & Stakeholders", prompt: "Likely buying committee for {name}: known names+titles where available, plus the roles to involve (economic buyer, champion, technical evaluator). Table: Person/Role | Title | Why they matter.", outputs: ["table"] },
        { id: "priorities", title: "Likely Priorities & Pain Points", prompt: "Infer {name}'s current priorities and pain points from the evidence, mapped to where a solution could help.", outputs: ["text"] },
        { id: "landscape", title: "Incumbents & Competitive Landscape", prompt: "What {name} likely uses today and which competitors are in play; implications for displacement.", outputs: ["text"] },
        { id: "value", title: "Value Hypothesis & Talking Points", prompt: "A crisp value hypothesis for {name} and 3-5 specific, evidence-grounded talking points.", outputs: ["text"] },
        { id: "questions", title: "Discovery Questions", prompt: "5-8 sharp, tailored discovery questions to ask {name} on the call.", outputs: ["text"] },
        { id: "objections", title: "Likely Objections & How to Handle", prompt: "Anticipated objections from {name} and a brief handling approach for each.", outputs: ["text"] },
        { id: "next_step", title: "Recommended Next Step", prompt: "The single best next step / call-to-action to propose, and why.", outputs: ["text"] },
        { id: "fit", title: "Fit Score", prompt: "Score how strong a fit/opportunity this looks (0-100) with a one-line justification.", outputs: ["score"], weight: 100 },
      ],
    },
  },
  {
    id: "builtin:competitor-teardown",
    def: {
      name: "Competitor Teardown",
      description: "A sharp competitive analysis: positioning, pricing, recent moves, strengths, gaps, target customers and where to win.",
      subjectType: "company",
      fast: false,
      inputs: [
        { key: "name", label: "Competitor name", required: true },
        { key: "website", label: "Website URL", prefillFrom: "company.domain" },
      ],
      sources: {
        webSearch: {
          enabled: true,
          queries: [
            "{name} pricing plans",
            "{name} product features",
            "{name} reviews g2 capterra",
            "{name} vs alternatives comparison",
            "{name} customers case studies",
            "{name} latest news launch funding",
            "{name} positioning messaging",
            "{name} weaknesses complaints",
          ],
        },
        crawl: { enabled: true, seeds: ["{website}"], maxPages: 14 },
        pagespeed: { enabled: true },
      },
      sections: [
        { id: "exec_summary", title: "Executive Summary", prompt: "TL;DR on {name} as a competitor: how they win, their biggest strength, their most exploitable gap.", outputs: ["text"] },
        { id: "positioning", title: "Positioning & Messaging", prompt: "How {name} positions itself: target audience, category, core message, and proof points.", outputs: ["text"] },
        { id: "products_pricing", title: "Products & Pricing", prompt: "Their product lineup and any pricing/packaging found — as a table (Plan/Product | Price | Notes).", outputs: ["table", "text"] },
        { id: "recent", title: "Recent Moves", prompt: "Recent launches, funding, M&A, exec changes for {name} — most recent first, dated (Date | Move | Implication).", outputs: ["table"] },
        { id: "strengths", title: "Strengths", prompt: "{name}'s genuine strengths, with evidence.", outputs: ["text"] },
        { id: "gaps", title: "Weaknesses & Gaps", prompt: "{name}'s weaknesses, common complaints (from reviews), and gaps — as a table where possible.", outputs: ["table", "text"] },
        { id: "customers", title: "Target Customers & Traction", prompt: "Who {name} sells to (segment/ICP) and traction signals (logos, scale).", outputs: ["text"] },
        { id: "win", title: "Where to Win", prompt: "Concrete angles to win against {name}: positioning, features, segments, objections to plant.", outputs: ["text"] },
        { id: "threat", title: "Threat Level", prompt: "Rate {name}'s competitive threat (0-100) with a one-line justification.", outputs: ["score"], weight: 100 },
      ],
    },
  },
  {
    id: "builtin:marketing-audit",
    def: {
      name: "Marketing Audit",
      description: "An end-to-end marketing audit: snapshot, SWOT, channels, website/SEO health and a 90-day plan.",
      subjectType: "freeform",
      fast: false,
      inputs: [
        { key: "name", label: "Business name", required: true },
        { key: "website", label: "Website URL" },
        { key: "industry", label: "Industry" },
      ],
      sources: {
        webSearch: {
          enabled: true,
          queries: [
            "{name} {industry} overview",
            "{name} reviews reputation",
            "{name} social media presence",
            "{name} competitors {industry}",
            "{industry} marketing trends",
            "{name} latest news",
          ],
        },
        crawl: { enabled: true, seeds: ["{website}"], maxPages: 12 },
        pagespeed: { enabled: true },
      },
      sections: [
        { id: "summary", title: "Executive Summary", prompt: "Executive summary of {name}'s marketing strengths, weaknesses, opportunities and threats — lead with the biggest opportunity.", outputs: ["text"] },
        { id: "snapshot", title: "Business & Digital Snapshot", prompt: "Snapshot of {name}: positioning, channels present, and baseline digital signals — as a table plus context.", outputs: ["table", "text"] },
        { id: "swot", title: "SWOT & Key Findings", prompt: "A grounded SWOT for {name} as a table (Strengths/Weaknesses/Opportunities/Threats).", outputs: ["table"] },
        { id: "website", title: "Website & SEO Health", prompt: "Assess {name}'s website experience and (using the site performance data) technical/SEO health, with specific fixes.", outputs: ["text"] },
        { id: "channels", title: "Channel Recommendations", prompt: "Recommend marketing channels and tactics for {name} with rationale — as a table (Channel | Why | First action).", outputs: ["table", "text"] },
        { id: "plan", title: "90-Day Plan", prompt: "A prioritised 90-day execution plan for {name} (30/60/90), each with concrete deliverables.", outputs: ["text"] },
        { id: "score", title: "Marketing Health Score", prompt: "Score {name}'s marketing health (0-100) with a one-line justification.", outputs: ["score"], weight: 100 },
      ],
    },
  },
];

export const getBuiltinTemplate = (id: string): BuiltinTemplate | undefined =>
  BUILTIN_TEMPLATES.find((t) => t.id === id);

export const isBuiltinId = (id: string): boolean => id.startsWith(BUILTIN_PREFIX);
