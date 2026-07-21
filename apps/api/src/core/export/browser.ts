// Headless-Chromium launcher for HTML→PDF quotation rendering. Soft dependency: the
// driver (playwright-core) and the serverless Chromium (@sparticuz/chromium) are imported
// dynamically, so the app builds/runs even where they're absent — the caller then falls
// back to the pdf-lib renderer. Two environments are supported:
//   • dev / CI / long-running server → the Chromium already installed by Playwright
//     (located under PLAYWRIGHT_BROWSERS_PATH), driven directly.
//   • serverless (Vercel / AWS Lambda)  → @sparticuz/chromium's slim Chromium build.
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// Minimal structural types for the soft-imported driver, so this file type-checks without
// the package's own types being resolved (mirrors research/sources/crawl.ts).
interface PwPage {
  setContent(html: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  pdf(opts: Record<string, unknown>): Promise<Uint8Array>;
  emulateMedia?(opts: { media?: string }): Promise<unknown>;
}
interface PwBrowser { newPage(): Promise<PwPage>; close(): Promise<void>; }
interface PwChromium { launch(opts: { headless?: boolean; executablePath?: string; args?: string[] }): Promise<PwBrowser>; }

export interface LaunchedBrowser { browser: PwBrowser; page: PwPage; }

const isServerless = (): boolean =>
  !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_EXECUTION_ENV || process.env.QUOTE_PDF_SERVERLESS === "true");

// Locate the installed Playwright Chromium in dev/CI. Prefer the headless-shell binary —
// recent Chromium builds removed the legacy "--headless=old" mode the full chrome binary
// otherwise gets launched with — and fall back to the full chrome binary. The build-number
// folder varies between images, so glob for it rather than hardcoding.
function findLocalChromium(): string | null {
  const override = process.env.QUOTE_PDF_CHROMIUM_PATH?.trim();
  if (override) return existsSync(override) ? override : null;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH?.trim() || "/opt/pw-browsers";
  if (!existsSync(root)) return null;
  let dirs: string[];
  try { dirs = readdirSync(root); } catch { return null; }
  const pick = (prefix: string, bin: string): string | null => {
    const d = dirs.filter((n) => n.startsWith(prefix)).sort().reverse()[0];
    if (!d) return null;
    const p = join(root, d, "chrome-linux", bin);
    return existsSync(p) ? p : null;
  };
  return pick("chromium_headless_shell-", "headless_shell") ?? pick("chromium-", "chrome");
}

// Launch a headless Chromium and open a blank page. Returns null when Chromium/driver is
// unavailable or launch fails, so the caller degrades to the pdf-lib renderer instead of
// erroring. The caller MUST close the returned browser (see renderQuotationPdfHtml).
export async function launchPdfBrowser(): Promise<LaunchedBrowser | null> {
  let chromium: PwChromium;
  try {
    const mod = (await import("playwright-core" as string)) as { chromium: PwChromium };
    chromium = mod.chromium;
    if (!chromium?.launch) return null;
  } catch {
    return null; // driver not installed
  }

  let executablePath: string | undefined;
  let args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"];

  if (isServerless()) {
    try {
      const sp = (await import("@sparticuz/chromium" as string)) as { default?: unknown } & Record<string, unknown>;
      const chr = (sp.default ?? sp) as { executablePath: () => Promise<string>; args?: string[] };
      executablePath = await chr.executablePath();
      if (Array.isArray(chr.args)) args = chr.args;
    } catch {
      return null; // serverless Chromium package not available
    }
  } else {
    executablePath = findLocalChromium() ?? undefined;
    if (!executablePath) return null; // no local Chromium found
  }

  try {
    const browser = await chromium.launch({ headless: true, executablePath, args });
    const page = await browser.newPage();
    return { browser, page };
  } catch {
    return null;
  }
}
