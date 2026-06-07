// Google PageSpeed Insights (RS-1). Free; an API key (PAGESPEED_API_KEY) lifts the
// rate limit but is optional. Returns a 0-100 performance score (and a couple of
// headline metrics) for a URL, or null if unavailable. Ported from the original
// ai-audit services/seo.py.

import { fetchWithTimeout } from "./http";

const API = "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

export interface PageSpeedResult {
  url: string;
  performanceScore: number | null; // 0-100
  metrics: Record<string, string>;
}

export async function fetchPageSpeed(url: string): Promise<PageSpeedResult | null> {
  let target = url.trim();
  if (!target) return null;
  if (!/^https?:\/\//i.test(target)) target = `https://${target}`;
  const u = new URL(API);
  u.searchParams.set("url", target);
  u.searchParams.set("category", "performance");
  u.searchParams.set("strategy", "mobile");
  const key = process.env.PAGESPEED_API_KEY;
  if (key) u.searchParams.set("key", key);
  try {
    const res = await fetchWithTimeout(u.toString(), 20_000, { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      lighthouseResult?: {
        categories?: { performance?: { score?: number } };
        audits?: Record<string, { displayValue?: string }>;
      };
    };
    const raw = data.lighthouseResult?.categories?.performance?.score;
    const performanceScore = typeof raw === "number" ? Math.round(raw * 100) : null;
    const audits = data.lighthouseResult?.audits ?? {};
    const metrics: Record<string, string> = {};
    for (const k of ["first-contentful-paint", "largest-contentful-paint", "speed-index", "total-blocking-time"]) {
      const dv = audits[k]?.displayValue;
      if (dv) metrics[k] = dv;
    }
    return { url: target, performanceScore, metrics };
  } catch {
    return null;
  }
}
