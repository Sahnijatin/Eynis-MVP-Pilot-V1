// Public customer quote link (Phase 6). Unauthenticated by design: possession of
// the unguessable token IS the credential (192-bit random, only its SHA-256 at
// rest — same pattern as team invites). The payload is the customer-safe view
// (piece + spec + selling amount + GST); internal cost/overhead/margin never
// leaves the tenant. Decisions drive the SAME state machine + deal commit as
// staff actions and are audit-logged with actorRole "customer".

import type { IncomingMessage, ServerResponse } from "node:http";
import { json, parseObjectBody, parseUrl, asTrimmedString, clientIp } from "../../http/helpers";
import { rateLimit } from "../rate-limit";
import { loadReportBrand } from "../export/brand";
import * as quotes from "./service";
import { parseLineImages, flattenLineImages } from "./quotation";

const TOKEN_RE = /^\/public\/quotes\/([A-Za-z0-9_-]{16,128})(?:\/(accept|decline))?$/;

export async function handlePublicQuoteRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const routePath = parseUrl(req.url).pathname;
  if (!routePath.startsWith("/public/quotes/")) return false;
  const match = TOKEN_RE.exec(routePath);
  if (!match) { json(res, 404, { ok: false, error: "Quote not found" }); return true; }
  const [, token, action] = match;

  // Throttle lookups AND decisions per IP: the token space is unguessable, but a
  // limiter keeps enumeration attempts and decision spam boring.
  const ip = clientIp(req);
  if (!(await rateLimit(`public-quote:${ip}`, 30, 60_000))) {
    json(res, 429, { ok: false, error: "Too many requests. Please try again shortly." });
    return true;
  }

  const quote = await quotes.getQuoteByPublicToken(token);
  // Uniform 404 — an invalid token must be indistinguishable from a missing quote.
  if (!quote || quote.status === "draft") { json(res, 404, { ok: false, error: "Quote not found" }); return true; }
  const serialized = quotes.serializeQuote(quote as unknown as Parameters<typeof quotes.serializeQuote>[0]);

  // GET /public/quotes/:token — customer-safe view + tenant brand.
  if (!action && req.method === "GET") {
    const brand = await loadReportBrand(quote.tenantId);
    json(res, 200, {
      ok: true,
      quote: quotes.publicQuoteView(serialized),
      brand: { name: brand.brandName, logoUrl: brand.logoUrl, primaryColor: brand.primaryColor, showPoweredBy: brand.showPoweredBy, platformName: brand.platformName },
    });
    return true;
  }

  // POST /public/quotes/:token/accept | /decline — idempotent from the customer's
  // view: deciding an already-decided quote returns its final state, not an error.
  if (action && req.method === "POST") {
    if (quote.status !== "sent") {
      json(res, 200, { ok: true, alreadyDecided: true, status: quote.status });
      return true;
    }
    const result = action === "accept"
      ? await quotes.acceptQuote(quote.tenantId, quote.id, { actorRole: "customer" })
      : await quotes.rejectQuote(
          quote.tenantId, quote.id,
          asTrimmedString((await parseObjectBody(req)).reason) ?? "Declined by customer",
          { actorRole: "customer" },
        );
    if (!result.ok) { json(res, result.status, { ok: false, error: result.error }); return true; }
    json(res, 200, { ok: true, status: result.quote?.status });
    return true;
  }

  json(res, 404, { ok: false, error: "Quote not found" });
  return true;
}

// Public image serve — the destination of the PDF's "Image N" links. Gated by the
// quote's plaintext imageToken (image-read only; can't accept/decline). Serves the
// stored image bytes INLINE by default (opens in the browser) or as an attachment
// with ?download=1. Rate-limited per IP.
const IMAGE_RE = /^\/public\/quote-image\/([A-Za-z0-9_-]{16,64})\/(\d{1,3})$/;

export async function handlePublicQuoteImageRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = parseUrl(req.url);
  if (!url.pathname.startsWith("/public/quote-image/")) return false;
  const match = IMAGE_RE.exec(url.pathname);
  if (!match || req.method !== "GET") { json(res, 404, { ok: false, error: "Not found" }); return true; }
  const [, token, idxStr] = match;

  const ip = clientIp(req);
  if (!(await rateLimit(`public-quote-image:${ip}`, 120, 60_000))) {
    json(res, 429, { ok: false, error: "Too many requests. Please try again shortly." });
    return true;
  }

  // Any status is fine here (staff may share a draft's PDF): the unguessable token is
  // the credential and it grants image-read only, never accept/decline.
  const quote = await quotes.getQuoteByImageToken(token);
  if (!quote) { json(res, 404, { ok: false, error: "Not found" }); return true; }

  const images = flattenLineImages(parseLineImages(quote.lineImagesJson));
  const src = images[Number(idxStr)];
  const dm = src ? /^data:(image\/(?:png|jpe?g));base64,(.+)$/.exec(src) : null;
  if (!dm) { json(res, 404, { ok: false, error: "Not found" }); return true; }

  const buf = Buffer.from(dm[2], "base64");
  const download = url.searchParams.get("download") === "1";
  const ext = dm[1].includes("png") ? "png" : "jpg";
  const filename = `quote-${quote.number}-image-${Number(idxStr) + 1}.${ext}`;
  res.writeHead(200, {
    "content-type": dm[1],
    "content-length": buf.length,
    "content-disposition": `${download ? "attachment" : "inline"}; filename="${filename}"`,
    "cache-control": "private, max-age=300",
  });
  res.end(buf);
  return true;
}
