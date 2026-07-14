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
