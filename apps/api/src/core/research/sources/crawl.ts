// Page content extraction (RS-1). Dependency-free: plain fetch + a lightweight
// HTML→text reduction (strip scripts/styles/markup, collapse whitespace). This
// keeps the gather layer cheap and CI/serverless-safe — no headless browser, no
// native binaries. A Playwright/readability fallback for JS-heavy sites is a
// deliberate later enhancement (RS-4); most marketing/company sites render enough
// in static HTML for synthesis.

import { lookup } from "node:dns/promises";
import net from "node:net";

export interface PageContent {
  url: string;
  title: string;
  text: string;
}

const USER_AGENT =
  process.env.RESEARCH_USER_AGENT ??
  "Mozilla/5.0 (compatible; EynisResearchBot/1.0; +https://eynis.example/bot)";

// ── SSRF protection ───────────────────────────────────────────────────────────
// Crawl fetches URLs that come from tenant-authored templates / run inputs, so a
// user could otherwise point the server at internal services or cloud metadata
// (169.254.169.254), localhost, or private ranges. We resolve the host and reject
// any private/reserved address, and we follow redirects MANUALLY so a public URL
// can't 3xx-redirect into a private one. (Residual DNS-rebinding risk is noted in
// the design doc; the guard blocks the common direct + redirect SSRF vectors.)
function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const p = ip.split(".").map(Number);
    const [a, b] = p;
    if (a === 10 || a === 127 || a === 0) return true;
    if (a === 169 && b === 254) return true; // link-local / metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("fe80")) return true; // link-local
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(lower);
  if (mapped) return isPrivateIp(mapped[1]);
  return false;
}

async function hostIsPublic(hostname: string): Promise<boolean> {
  if (!hostname || hostname.toLowerCase() === "localhost") return false;
  if (net.isIP(hostname)) return !isPrivateIp(hostname);
  try {
    const addrs = await lookup(hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

// Fetch with timeout + manual redirect handling, validating every hop's host.
async function safeFetch(rawUrl: string, maxRedirects = 3): Promise<Response | null> {
  let current = rawUrl;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let u: URL;
    try { u = new URL(current); } catch { return null; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!(await hostIsPublic(u.hostname))) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let res: Response;
    try {
      res = await fetch(u.toString(), {
        redirect: "manual",
        signal: controller.signal,
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
      });
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, u).toString(); // re-validated at the top of the loop
      continue;
    }
    return res;
  }
  return null; // too many redirects
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
    const res = await safeFetch(normalized);
    if (!res || !res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html") && ct !== "") return null;
    const html = await res.text();
    const text = htmlToText(html);
    if (!text) return null;
    return { url: res.url || normalized, title: extractTitle(html) || normalized, text };
  } catch {
    return null;
  }
}
