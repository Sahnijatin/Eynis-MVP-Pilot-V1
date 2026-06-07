// Page content extraction (RS-1). Dependency-free: plain fetch + a lightweight
// HTML→text reduction (strip scripts/styles/markup, collapse whitespace). This
// keeps the gather layer cheap and CI/serverless-safe — no headless browser, no
// native binaries. A Playwright/readability fallback for JS-heavy sites is a
// deliberate later enhancement (RS-4); most marketing/company sites render enough
// in static HTML for synthesis.

import { fetchWithTimeout } from "./http";

export interface PageContent {
  url: string;
  title: string;
  text: string;
}

const decodeEntities = (s: string): string =>
  s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");

function extractTitle(html: string): string {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return m ? decodeEntities(m[1].replace(/\s+/g, " ").trim()).slice(0, 200) : "";
}

// Reduce an HTML document to readable text. Removes non-content elements, drops
// all tags, decodes common entities, and collapses whitespace. Capped so a huge
// page can't blow the synthesis token budget.
export function htmlToText(html: string, maxChars = 4000): string {
  const stripped = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<(nav|footer|header|svg|form)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6]|br|tr|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(stripped)
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n\s*\n\s*\n+/g, "\n\n")
    .trim()
    .slice(0, maxChars);
}

// Only fetch http(s) pages, and only when the response looks like HTML — guards
// against accidentally pulling a binary/PDF into the text pipeline.
export async function fetchReadable(url: string): Promise<PageContent | null> {
  let normalized = url.trim();
  if (!normalized) return null;
  if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;
  try {
    const res = await fetchWithTimeout(normalized, 15_000, { headers: { accept: "text/html,application/xhtml+xml" } });
    if (!res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html") && ct !== "") return null;
    const html = await res.text();
    const text = htmlToText(html);
    if (!text) return null;
    return { url: normalized, title: extractTitle(html) || normalized, text };
  } catch {
    return null;
  }
}
