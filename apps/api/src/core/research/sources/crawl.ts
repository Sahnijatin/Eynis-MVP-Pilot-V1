// Page content extraction (RS-1, RS-4). The default path is dependency-free:
// plain fetch + a lightweight HTML→text reduction (strip scripts/styles/markup,
// collapse whitespace) — cheap and CI/serverless-safe (no headless browser, no
// native binaries). For JS-heavy sites that ship an near-empty static shell, an
// OPTIONAL Playwright fallback (RS-4) renders the page when it's both installed
// and enabled via RESEARCH_PLAYWRIGHT_ENABLED. Playwright is imported lazily and
// is NOT a declared dependency, so environments without it (incl. CI) behave
// exactly as before — the fallback is simply skipped.

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
async function fetchStatic(normalized: string): Promise<PageContent | null> {
  try {
    const res = await safeFetch(normalized);
    if (!res || !res.ok) return null;
    const ct = res.headers.get("content-type") ?? "";
    if (!ct.includes("html") && ct !== "") return null;
    // Cap the body before processing so a huge page can't blow memory / slow the regex.
    const html = (await res.text()).slice(0, 2_000_000);
    const text = htmlToText(html);
    if (!text) return null;
    return { url: res.url || normalized, title: extractTitle(html) || normalized, text };
  } catch {
    return null;
  }
}

// A page that yields very little static text is likely client-rendered (a JS
// shell) — the case the Playwright fallback exists for.
const JS_MIN_CHARS = Number(process.env.RESEARCH_JS_MIN_CHARS ?? 250);
export function needsDynamicRender(text: string | null | undefined): boolean {
  return (text?.trim().length ?? 0) < JS_MIN_CHARS;
}

// Literal private/loopback hosts are blocked synchronously during navigation so a
// client-side redirect can't pull the headless browser onto an internal IP. (DNS
// names are validated up-front via hostIsPublic; DNS-rebinding remains a noted
// residual risk, as with the static path.)
function hostIsLiteralPrivate(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, "");
  if (h.toLowerCase() === "localhost") return true;
  return net.isIP(h) ? isPrivateIp(h) : false;
}

// Optional Playwright fallback. Lazily + dynamically imported (via a non-literal
// specifier so TS doesn't require the package), so it's a soft dependency: if it
// isn't installed or no browser is present, launch throws and we return null.
async function fetchWithPlaywright(normalized: string): Promise<PageContent | null> {
  if (process.env.RESEARCH_PLAYWRIGHT_ENABLED !== "true") return null;
  let u: URL;
  try { u = new URL(normalized); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (!(await hostIsPublic(u.hostname))) return null;

  const specifier = "playwright";
  let pw: { chromium: { launch: (opts: { headless: boolean }) => Promise<PlaywrightBrowser> } };
  try {
    pw = (await import(specifier)) as typeof pw;
  } catch {
    return null; // package not installed — fallback unavailable
  }

  let browser: PlaywrightBrowser | null = null;
  try {
    browser = await pw.chromium.launch({ headless: true });
    const context = await browser.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();
    // Block navigation/subrequests to literal private IPs (cheap, no DNS).
    await page.route("**/*", (route: PlaywrightRoute) => {
      try {
        const reqUrl = new URL(route.request().url());
        if (hostIsLiteralPrivate(reqUrl.hostname)) { void route.abort(); return; }
      } catch { /* fall through to continue */ }
      void route.continue();
    });
    const timeoutMs = Number(process.env.RESEARCH_PLAYWRIGHT_TIMEOUT_MS ?? 20_000);
    await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: timeoutMs });
    const html = (await page.content()).slice(0, 2_000_000);
    const text = htmlToText(html);
    if (!text) return null;
    return { url: page.url() || normalized, title: extractTitle(html) || normalized, text };
  } catch {
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

// Page content for a URL: static fetch first (cheap), and — only when the static
// HTML is too thin to be useful and the Playwright fallback is enabled — a headless
// render. Returns whichever yields more usable text. Callers (and the per-tenant
// cache in gather.ts) see one stable entry point.
export async function fetchReadable(url: string): Promise<PageContent | null> {
  let normalized = url.trim();
  if (!normalized) return null;
  if (!/^https?:\/\//i.test(normalized)) normalized = `https://${normalized}`;

  const stat = await fetchStatic(normalized);
  if (stat && !needsDynamicRender(stat.text)) return stat;

  const dynamic = await fetchWithPlaywright(normalized);
  if (dynamic && (!stat || dynamic.text.length > stat.text.length)) return dynamic;
  return stat;
}

// Minimal structural types for the optionally-present Playwright package, so this
// file type-checks without `playwright` (or its types) installed.
interface PlaywrightRoute { request(): { url(): string }; abort(): Promise<void>; continue(): Promise<void> }
interface PlaywrightPage { route(glob: string, handler: (route: PlaywrightRoute) => void): Promise<void>; goto(url: string, opts: { waitUntil: string; timeout: number }): Promise<unknown>; content(): Promise<string>; url(): string }
interface PlaywrightContext { newPage(): Promise<PlaywrightPage> }
interface PlaywrightBrowser { newContext(opts: { userAgent: string }): Promise<PlaywrightContext>; close(): Promise<void> }
