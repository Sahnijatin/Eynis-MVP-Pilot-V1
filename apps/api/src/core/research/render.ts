// Maps a synthesized research result into the platform's branded report blocks
// (RS-1), so research reports render + export through the exact same white-label
// pipeline as every other report (renderBrandedReportHtml / renderBrandedReportPdf
// / brandedCsv). No bespoke rendering code for this module.

import type { ReportBlock } from "../export/report-html";
import type { SynthResult } from "./synthesize";

const BULLET_RE = /^([-*•]|\d+\.)\s+/;

export function buildReportBlocks(opts: {
  title: string;
  subject: string;
  score: number | null;
  result: SynthResult;
}): ReportBlock[] {
  const blocks: ReportBlock[] = [];
  const headline =
    opts.score != null
      ? `${opts.subject || opts.title} — overall score ${opts.score}/100`
      : opts.subject || opts.title;
  blocks.push({ kind: "headline", text: headline });

  for (const s of opts.result.sections) {
    const heading = s.score != null ? `${s.title} — ${s.score}/100` : s.title;
    const lines = s.content.split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const bullets = lines.filter((l) => BULLET_RE.test(l));
    // Render mostly-bulleted content as a clean list; otherwise a prose section.
    if (bullets.length >= 2 && bullets.length >= lines.length * 0.6) {
      blocks.push({ kind: "list", heading, items: bullets.map((b) => b.replace(BULLET_RE, "")) });
    } else {
      blocks.push({ kind: "section", heading, body: s.content });
    }
    if (s.table && (s.table.headers.length || s.table.rows.length)) {
      blocks.push({ kind: "table", header: s.table.headers, rows: s.table.rows });
    }
  }
  return blocks;
}

// Flatten a result to CSV (header + rows) — one row per section with its score and
// a trimmed snippet. Tables are summarised by row-count to keep the CSV flat.
export function buildReportCsv(result: SynthResult): { header: string[]; rows: Array<Array<string | number>> } {
  return {
    header: ["Section", "Score", "Summary"],
    rows: result.sections.map((s) => [
      s.title,
      s.score == null ? "" : s.score,
      s.content.replace(/\s+/g, " ").slice(0, 300),
    ]),
  };
}
