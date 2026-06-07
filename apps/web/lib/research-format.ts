// Pure formatting helpers for rendering research section content (RS-4). Kept
// framework-free so they're unit-testable without a React/DOM harness — this is
// the module's first web-side test target.

const BULLET_RE = /^([-*•]|\d+\.)\s+/;

export type SectionBlock = { kind: "list"; items: string[] } | { kind: "text"; text: string };

// Decide whether a section's content should render as a bullet list or prose.
// Mostly-bulleted content → a clean list; otherwise the raw text.
export function splitSectionContent(content: string): SectionBlock {
  const lines = content.split(/\n+/).map((l) => l.trim()).filter(Boolean);
  const bullets = lines.filter((l) => BULLET_RE.test(l));
  if (bullets.length >= 2 && bullets.length >= lines.length * 0.6) {
    return { kind: "list", items: bullets.map((b) => b.replace(BULLET_RE, "")) };
  }
  return { kind: "text", text: content };
}

// Compact a one-line cost/usage summary for a finished run.
export function usageSummary(usage: {
  provider?: string; llmCalls?: number; usedAI?: boolean; sourcesFetched?: number; cacheHits?: number; durationMs?: number;
} | null | undefined): string {
  if (!usage) return "";
  const parts: string[] = [];
  if (usage.usedAI === false) parts.push("no-AI fallback");
  else if (usage.llmCalls != null) parts.push(`${usage.llmCalls} AI call${usage.llmCalls === 1 ? "" : "s"} (${usage.provider ?? "claude"})`);
  if (usage.sourcesFetched != null) parts.push(`${usage.sourcesFetched} sources`);
  if (usage.cacheHits) parts.push(`${usage.cacheHits} cached`);
  if (usage.durationMs != null) parts.push(`${(usage.durationMs / 1000).toFixed(1)}s`);
  return parts.join(" · ");
}
