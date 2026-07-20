// Quotes domain router (5.1) — extracted verbatim from server.ts (templates,
// calc, AI parse, CRUD, lifecycle, PDF, BUSY export). Returns true when the
// request was handled; false lets the main dispatcher continue. Authorization
// goes through the shared authorize()/permissionMap contract.
import type { IncomingMessage, ServerResponse } from "node:http";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { authorize } from "../authz";
import { json, parseBody, parseObjectBody, asTrimmedString, parseUrl, asSafeLimit, asSafeOffset, numOrNull, numUndef, dateOrNull, normalizePhoneE164, sendBinary, sendDoc } from "../../http/helpers";
import * as quotes from "./service";
import type { FollowupResult } from "./followup";
import { upsertContactByPhone } from "../crm/upsert-contact";
import { loadReportBrand } from "../export/brand";
import { renderBrandedReportPdf } from "../export/report-pdf";
import { buildQuotationView, serializeSeller, serializeBillTo, serializeLineImages, serializeHsnByGroup, serializeQtyByGroup, serializeGstByGroup, parseGstByGroup } from "./quotation";
import { renderQuotationPdf } from "../export/quote-pdf";
import { resolveAiCredentials, aiConfigured, chooseProvider, providerKey } from "../research/ai-credentials";
import { aiCompleteTiered, extractJson } from "../ai/intelligence";

// Quote create/update carry resized (≤1600px) images inline, so these routes accept a
// larger body than the tight global default (the whole-quote image budget is 6 MB).
const QUOTE_BODY_MAX_BYTES = 8 * 1024 * 1024;

export async function handleQuoteRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const routePath = parseUrl(req.url).pathname;
  if (!(routePath === "/quotes" || routePath.startsWith("/quotes/") || routePath === "/quote-templates" || routePath.startsWith("/quote-templates/"))) return false;

// ── Quoting + component-based costing (furniture/manufacturing) ───────────
    // A quote is a bill of materials: line items (components) costed by dimension ×
    // rate + labor, rolled up with overhead + margin. Sent quotes are immutable
    // (rates snapshotted at add-time; edits rejected once status leaves "draft").

    // Quote templates (reusable presets, e.g. "Dining Table").
    if (req.url === "/quote-templates" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /quote-templates");
      if (!auth.ok) return true;
      json(res, 200, { ok: true, items: await quotes.listTemplates(auth.context.tenantId) });
      return true;
    }
    if (req.url === "/quote-templates" && req.method === "POST") {
      const auth = await authorize(req, res, "POST /quote-templates");
      if (!auth.ok) return true;
      const body = await parseObjectBody(req);
      const name = asTrimmedString(body.name);
      if (!name) { json(res, 400, { ok: false, error: "name is required" }); return true; }
      try {
        const tpl = await quotes.createTemplate(auth.context.tenantId, { ...body, name } as unknown as quotes.TemplatePayload);
        json(res, 200, { ok: true, template: tpl });
      } catch (e) {
        json(res, 400, { ok: false, error: e instanceof Error ? e.message : "Invalid template" });
      }
      return true;
    }
    const tplMatch = /^\/quote-templates\/([^/]+)$/.exec(req.url ?? "");
    if (tplMatch && req.method === "GET") {
      const auth = await authorize(req, res, "GET /quote-templates/:id");
      if (!auth.ok) return true;
      const tpl = await quotes.getTemplate(auth.context.tenantId, tplMatch[1]);
      if (!tpl) { json(res, 404, { ok: false, error: "Template not found" }); return true; }
      json(res, 200, { ok: true, template: tpl });
      return true;
    }
    if (tplMatch && req.method === "PATCH") {
      const auth = await authorize(req, res, "PATCH /quote-templates/:id");
      if (!auth.ok) return true;
      const body = await parseObjectBody(req);
      const tpl = await quotes.updateTemplate(auth.context.tenantId, tplMatch[1], body as unknown as quotes.TemplatePayload);
      if (!tpl) { json(res, 404, { ok: false, error: "Template not found" }); return true; }
      json(res, 200, { ok: true, template: tpl });
      return true;
    }
    if (tplMatch && req.method === "DELETE") {
      const auth = await authorize(req, res, "DELETE /quote-templates/:id");
      if (!auth.ok) return true;
      const ok = await quotes.deleteTemplate(auth.context.tenantId, tplMatch[1]);
      if (!ok) { json(res, 404, { ok: false, error: "Template not found" }); return true; }
      json(res, 200, { ok: true });
      return true;
    }

    // Live cost preview — no persistence. Powers the "as you type" builder totals.
    if (req.url === "/quotes/calc" && req.method === "POST") {
      const auth = await authorize(req, res, "POST /quotes/calc");
      if (!auth.ok) return true;
      const body = await parseObjectBody(req);
      const lines = Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]) : [];
      const costingMod = await import("./costing");
      const preview = costingMod.priceQuote(
        lines.map((l) => ({
          costBasis: quotes.normalizeBasis(l.costBasis),
          lengthMm: numOrNull(l.lengthMm),
          widthMm: numOrNull(l.widthMm),
          heightMm: numOrNull(l.heightMm),
          quantity: Number(l.quantity) || 1,
          unitRatePaise: Math.max(0, Math.round(Number(l.unitRatePaise) || 0)),
          wastagePct: Math.max(0, Number(l.wastagePct) || 0),
          laborHours: Math.max(0, Number(l.laborHours) || 0),
          laborRatePaise: Math.max(0, Math.round(Number(l.laborRatePaise) || 0)),
        })),
        {
          overheadPct: Number(body.overheadPct) || 0,
          marginPct: Number(body.marginPct) || 0,
          marginFloorPct: Number(body.marginFloorPct) || 0,
          discountPaise: Math.max(0, Math.round(Number(body.discountPaise) || 0)),
        },
      );
      json(res, 200, { ok: true, preview });
      return true;
    }

    // AI-assist: free text → draft line items (reviewed by a human before saving).
    if (req.url === "/quotes/parse" && req.method === "POST") {
      const auth = await authorize(req, res, "POST /quotes/parse");
      if (!auth.ok) return true;
      const body = await parseObjectBody(req);
      const text = asTrimmedString(body.text);
      if (!text) { json(res, 400, { ok: false, error: "text is required" }); return true; }
      // Resolve the tenant's AI credentials (Integrations key → env fallback) and pick
      // the provider the same way Research Studio does — so this works OpenAI-only and
      // honours RESEARCH_AI_PROVIDER, instead of wrongly preferring Claude whenever any
      // Anthropic key is present (which surfaced as a misleading "Could not parse").
      const creds = await resolveAiCredentials(auth.context.tenantId);
      if (!aiConfigured(creds)) { json(res, 200, { ok: true, lines: [], note: "AI is not configured; add an OpenAI or Anthropic key under Integrations, or enter line items manually." }); return true; }
      const provider = chooseProvider(creds);
      const apiKey = providerKey(creds, provider) ?? undefined;
      const system = "You extract furniture/manufacturing quote line items from a free-text description. " +
        "Return ONLY JSON: {\"lines\":[{\"groupName\":string,\"name\":string,\"kind\":\"material|labor|hardware|finish|other\"," +
        "\"costBasis\":\"area|length|perimeter|volume|fixed|hours\",\"lengthMm\":number|null,\"widthMm\":number|null," +
        "\"heightMm\":number|null,\"quantity\":number,\"materialUnit\":string}]}. Convert any dimensions to millimetres. " +
        "A flat panel/top is costBasis \"area\"; a leg/rail is \"length\"; hardware/fixed items are \"fixed\". Do not invent prices.";
      try {
        const raw = await aiCompleteTiered(text, { tier: "cheap", maxTokens: 1200, system, provider, apiKey });
        const parsed = extractJson(raw) as { lines?: unknown[] } | null;
        const out = Array.isArray(parsed?.lines) ? parsed!.lines : [];
        // Clamp everything server-side — never trust AI numbers directly.
        const lines = out.slice(0, 40).map((l) => {
          const o = (l ?? {}) as Record<string, unknown>;
          return {
            groupName: asTrimmedString(o.groupName) ?? "General",
            name: asTrimmedString(o.name) ?? "Component",
            kind: quotes.normalizeKind(o.kind),
            costBasis: quotes.normalizeBasis(o.costBasis),
            lengthMm: numOrNull(o.lengthMm),
            widthMm: numOrNull(o.widthMm),
            heightMm: numOrNull(o.heightMm),
            quantity: Math.max(0, Number(o.quantity) || 1),
            materialUnit: asTrimmedString(o.materialUnit) ?? "sqft",
            unitRatePaise: 0,
          };
        });
        // Distinguish "the model replied but we couldn't extract items" from a hard failure.
        const note = lines.length === 0 ? "The AI could not extract line items from that description — try adding dimensions, or enter them manually." : undefined;
        json(res, 200, { ok: true, lines, ...(note ? { note } : {}) });
      } catch (err) {
        // Log the real reason server-side (key invalid, model access, network) — never
        // leak provider error text to the client.
        console.warn(`[quotes/parse] AI request failed (provider=${provider}):`, err instanceof Error ? err.message : err);
        json(res, 200, { ok: true, lines: [], note: `AI request failed (${provider}). Check the ${provider === "openai" ? "OpenAI" : "Anthropic"} key in Integrations, or enter line items manually.` });
      }
      return true;
    }

    if (req.url?.startsWith("/quotes") && parseUrl(req.url).pathname === "/quotes" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /quotes");
      if (!auth.ok) return true;
      const qs = parseUrl(req.url).searchParams;
      const limit = asSafeLimit(qs.get("limit"), 50, 200);
      const offset = asSafeOffset(qs.get("offset"));
      const { items, total } = await quotes.listQuotes(auth.context.tenantId, {
        status: asTrimmedString(qs.get("status")) ?? undefined,
        contactId: asTrimmedString(qs.get("contactId")) ?? undefined,
        dealId: asTrimmedString(qs.get("dealId")) ?? undefined,
        limit, offset,
      });
      json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + items.length < total } });
      return true;
    }
    if (req.url === "/quotes" && req.method === "POST") {
      const auth = await authorize(req, res, "POST /quotes");
      if (!auth.ok) return true;
      const body = await parseObjectBody(req, QUOTE_BODY_MAX_BYTES); // carries resized images
      const title = asTrimmedString(body.title);
      if (!title) { json(res, 400, { ok: false, error: "title is required" }); return true; }
      // Resolve the customer: an explicit contactId, else a new-customer object
      // {fullName, phoneE164, email} which we find-or-create by phone. Linking a
      // contact is what lets Send start the follow-up drip (a quote with no contact
      // can only log a task — the drip has no channel to reach).
      let contactId = asTrimmedString(body.contactId);
      if (!contactId && body.customer && typeof body.customer === "object") {
        const cust = body.customer as Record<string, unknown>;
        const phone = normalizePhoneE164(asTrimmedString(cust.phoneE164));
        if (phone) {
          const existing = await prisma.contact.findFirst({ where: { tenantId: auth.context.tenantId, phoneE164: phone }, select: { id: true } });
          if (existing) {
            contactId = existing.id;
          } else {
            const c = await prisma.contact.create({
              data: {
                tenantId: auth.context.tenantId,
                fullName: asTrimmedString(cust.fullName) ?? "Customer",
                phoneE164: phone,
                email: asTrimmedString(cust.email),
                source: "quote",
              },
              select: { id: true },
            });
            contactId = c.id;
          }
        }
      }
      try {
        const quote = await quotes.createQuote(auth.context.tenantId, {
          title,
          contactId,
          companyId: asTrimmedString(body.companyId),
          dealId: asTrimmedString(body.dealId),
          templateId: asTrimmedString(body.templateId),
          overheadPct: numUndef(body.overheadPct),
          marginPct: numUndef(body.marginPct),
          marginFloorPct: numUndef(body.marginFloorPct),
          discountPaise: numUndef(body.discountPaise),
          gstPercent: numUndef(body.gstPercent),
          validUntil: dateOrNull(body.validUntil),
          notes: asTrimmedString(body.notes),
          terms: asTrimmedString(body.terms),
          createdById: auth.context.userId,
          seller: body.seller !== undefined ? body.seller : undefined,
          billTo: body.billTo !== undefined ? body.billTo : undefined,
          lineImages: body.lineImages !== undefined ? body.lineImages : undefined,
          hsn: body.hsn !== undefined ? body.hsn : undefined,
          qty: body.qty !== undefined ? body.qty : undefined,
          gst: body.gst !== undefined ? body.gst : undefined,
          lines: Array.isArray(body.lines) ? (body.lines as quotes.LineInputPayload[]) : undefined,
        });
        json(res, 200, { ok: true, quote });
      } catch (e) {
        json(res, 400, { ok: false, error: e instanceof Error ? e.message : "Invalid quote" });
      }
      return true;
    }

    // Sub-routes: /quotes/:id[/lines[/:lineId]|/send|/accept|/reject|/expire|/pdf|/busy-export|/public-link]
    const quoteMatch = /^\/quotes\/([^/]+)(?:\/(lines|send|accept|reject|expire|pdf|busy-export|public-link))?(?:\/([^/]+))?$/.exec(
      parseUrl(req.url ?? "").pathname,
    );
    if (quoteMatch) {
      const quoteId = quoteMatch[1];
      const sub = quoteMatch[2];
      const subId = quoteMatch[3];

      // GET /quotes/:id
      if (!sub && req.method === "GET") {
        const auth = await authorize(req, res, "GET /quotes/:id");
        if (!auth.ok) return true;
        const quote = await quotes.getQuote(auth.context.tenantId, quoteId);
        if (!quote) { json(res, 404, { ok: false, error: "Quote not found" }); return true; }
        json(res, 200, { ok: true, quote });
        return true;
      }
      // PATCH /quotes/:id (draft only)
      if (!sub && req.method === "PATCH") {
        const auth = await authorize(req, res, "PATCH /quotes/:id");
        if (!auth.ok) return true;
        const raw = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        if (!raw) { json(res, 404, { ok: false, error: "Quote not found" }); return true; }
        if (raw.status !== "draft") { json(res, 409, { ok: false, error: "Only draft quotes can be edited" }); return true; }
        const body = await parseObjectBody(req, QUOTE_BODY_MAX_BYTES); // carries resized images
        const fields: Record<string, unknown> = {};
        const t = asTrimmedString(body.title); if (t) fields.title = t;
        if (body.contactId !== undefined) fields.contactId = asTrimmedString(body.contactId);
        if (body.companyId !== undefined) fields.companyId = asTrimmedString(body.companyId);
        if (body.dealId !== undefined) fields.dealId = asTrimmedString(body.dealId);
        if (body.overheadPct !== undefined) fields.overheadPct = Number(body.overheadPct) || 0;
        if (body.marginPct !== undefined) fields.marginPct = Number(body.marginPct) || 0;
        if (body.marginFloorPct !== undefined) fields.marginFloorPct = Number(body.marginFloorPct) || 0;
        if (body.discountPaise !== undefined) fields.discountPaise = Math.max(0, Math.round(Number(body.discountPaise) || 0));
        if (body.gstPercent !== undefined) fields.gstPercent = Math.max(0, Number(body.gstPercent) || 0);
        if (body.validUntil !== undefined) fields.validUntil = dateOrNull(body.validUntil);
        if (body.notes !== undefined) fields.notes = asTrimmedString(body.notes);
        if (body.terms !== undefined) fields.terms = asTrimmedString(body.terms);
        if (body.seller !== undefined) fields.sellerJson = serializeSeller(body.seller);
        if (body.billTo !== undefined) fields.billToJson = serializeBillTo(body.billTo);
        if (body.lineImages !== undefined) fields.lineImagesJson = serializeLineImages(body.lineImages);
        if (body.hsn !== undefined) fields.hsnJson = serializeHsnByGroup(body.hsn);
        if (body.qty !== undefined) fields.qtyJson = serializeQtyByGroup(body.qty);
        if (body.gst !== undefined) fields.gstRatesJson = serializeGstByGroup(body.gst);
        await quotes.updateQuoteFields(auth.context.tenantId, quoteId, fields);
        // Optional full line-replace (the builder's Edit flow saves all lines at once).
        const quote = Array.isArray(body.lines)
          ? await quotes.replaceQuoteLines(auth.context.tenantId, quoteId, body.lines as quotes.LineInputPayload[])
          : await quotes.getQuote(auth.context.tenantId, quoteId);
        json(res, 200, { ok: true, quote });
        return true;
      }
      // DELETE /quotes/:id (draft only)
      if (!sub && req.method === "DELETE") {
        const auth = await authorize(req, res, "DELETE /quotes/:id");
        if (!auth.ok) return true;
        const raw = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        if (!raw) { json(res, 404, { ok: false, error: "Quote not found" }); return true; }
        if (raw.status !== "draft") { json(res, 409, { ok: false, error: "Only draft quotes can be deleted" }); return true; }
        await quotes.deleteQuote(auth.context.tenantId, quoteId);
        json(res, 200, { ok: true });
        return true;
      }
      // POST /quotes/:id/lines (draft only)
      if (sub === "lines" && !subId && req.method === "POST") {
        const auth = await authorize(req, res, "POST /quotes/:id/lines");
        if (!auth.ok) return true;
        const raw = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        if (!raw) { json(res, 404, { ok: false, error: "Quote not found" }); return true; }
        if (raw.status !== "draft") { json(res, 409, { ok: false, error: "Only draft quotes can be edited" }); return true; }
        const body = await parseObjectBody(req);
        const name = asTrimmedString(body.name);
        if (!name) { json(res, 400, { ok: false, error: "name is required" }); return true; }
        const quote = await quotes.addLine(auth.context.tenantId, quoteId, { ...body, name } as unknown as quotes.LineInputPayload);
        json(res, 200, { ok: true, quote });
        return true;
      }
      // PATCH /quotes/:id/lines/:lineId (draft only)
      if (sub === "lines" && subId && req.method === "PATCH") {
        const auth = await authorize(req, res, "PATCH /quotes/:id/lines/:lineId");
        if (!auth.ok) return true;
        const raw = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        if (!raw) { json(res, 404, { ok: false, error: "Quote not found" }); return true; }
        if (raw.status !== "draft") { json(res, 409, { ok: false, error: "Only draft quotes can be edited" }); return true; }
        const body = await parseObjectBody(req);
        const quote = await quotes.updateLine(auth.context.tenantId, quoteId, subId, body as unknown as quotes.LineInputPayload);
        if (!quote) { json(res, 404, { ok: false, error: "Line not found" }); return true; }
        json(res, 200, { ok: true, quote });
        return true;
      }
      // DELETE /quotes/:id/lines/:lineId (draft only)
      if (sub === "lines" && subId && req.method === "DELETE") {
        const auth = await authorize(req, res, "DELETE /quotes/:id/lines/:lineId");
        if (!auth.ok) return true;
        const raw = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        if (!raw) { json(res, 404, { ok: false, error: "Quote not found" }); return true; }
        if (raw.status !== "draft") { json(res, 409, { ok: false, error: "Only draft quotes can be edited" }); return true; }
        const quote = await quotes.deleteLine(auth.context.tenantId, quoteId, subId);
        if (!quote) { json(res, 404, { ok: false, error: "Line not found" }); return true; }
        json(res, 200, { ok: true, quote });
        return true;
      }
      // POST /quotes/:id/send — enforce margin floor, freeze, then follow-up (M3).
      if (sub === "send" && req.method === "POST") {
        const auth = await authorize(req, res, "POST /quotes/:id/send");
        if (!auth.ok) return true;
        const floor = await quotes.quoteFloorStatus(auth.context.tenantId, quoteId);
        if (!floor) { json(res, 404, { ok: false, error: "Quote not found" }); return true; }
        if (!quotes.canTransition(floor.status, "sent")) { json(res, 409, { ok: false, error: `Quote is already ${floor.status}` }); return true; }
        if (!floor.hasLines) { json(res, 422, { ok: false, error: "Quote has no line items" }); return true; }
        if (floor.floorViolation) {
          json(res, 422, { ok: false, error: "Quote margin is below the configured floor", minTotalPaise: floor.minTotalPaise, marginFloorPct: floor.marginFloorPct });
          return true;
        }
        const quote = await quotes.markSent(auth.context.tenantId, quoteId);
        // Self-serve link (Phase 6): mint the public token at send so the customer
        // can view + decide the quote themselves. Only the hash is stored.
        const token = await quotes.issuePublicToken(auth.context.tenantId, quoteId);
        const publicUrl = token ? quotes.publicQuoteUrl(token) : null;
        // Fire the multi-channel follow-up: log a CRM task and (if configured)
        // enroll the contact into the drip sequence. Best-effort — never blocks send.
        const raw = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        let followup: FollowupResult | undefined;
        if (raw) {
          const { runQuoteFollowup } = await import("./followup");
          followup = await runQuoteFollowup(auth.context.tenantId, {
            id: raw.id, number: raw.number, title: raw.title,
            contactId: raw.contactId, dealId: raw.dealId, createdById: raw.createdById,
            publicUrl,
          });
        }
        json(res, 200, { ok: true, quote, followup, publicUrl });
        return true;
      }
      // POST /quotes/:id/public-link — (re)issue the customer link. The raw token
      // is derivable only at mint time (hash at rest), so "copy link" re-mints —
      // and re-issuing atomically invalidates any previously shared link.
      if (sub === "public-link" && req.method === "POST") {
        const auth = await authorize(req, res, "POST /quotes/:id/public-link");
        if (!auth.ok) return true;
        const linkQuote = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        if (!linkQuote) { json(res, 404, { ok: false, error: "Quote not found" }); return true; }
        if (linkQuote.status === "draft") { json(res, 409, { ok: false, error: "Send the quote first — drafts have no customer link" }); return true; }
        const linkToken = await quotes.issuePublicToken(auth.context.tenantId, quoteId);
        if (!linkToken) { json(res, 404, { ok: false, error: "Quote not found" }); return true; }
        json(res, 200, { ok: true, url: quotes.publicQuoteUrl(linkToken) });
        return true;
      }
      // POST /quotes/:id/accept — via the shared decision core (same state machine,
      // deal commit, and audit trail the public customer link uses).
      if (sub === "accept" && req.method === "POST") {
        const auth = await authorize(req, res, "POST /quotes/:id/accept");
        if (!auth.ok) return true;
        const result = await quotes.acceptQuote(auth.context.tenantId, quoteId, { actorRole: "staff", actorId: auth.context.userId });
        if (!result.ok) { json(res, result.status, { ok: false, error: result.error, ...(result.minTotalPaise != null ? { minTotalPaise: result.minTotalPaise, marginFloorPct: result.marginFloorPct } : {}) }); return true; }
        json(res, 200, { ok: true, quote: result.quote });
        return true;
      }
      // POST /quotes/:id/reject — same shared decision core.
      if (sub === "reject" && req.method === "POST") {
        const auth = await authorize(req, res, "POST /quotes/:id/reject");
        if (!auth.ok) return true;
        const body = await parseObjectBody(req);
        const result = await quotes.rejectQuote(auth.context.tenantId, quoteId, asTrimmedString(body.reason), { actorRole: "staff", actorId: auth.context.userId });
        if (!result.ok) { json(res, result.status, { ok: false, error: result.error }); return true; }
        json(res, 200, { ok: true, quote: result.quote });
        return true;
      }
      // POST /quotes/:id/expire
      if (sub === "expire" && req.method === "POST") {
        const auth = await authorize(req, res, "POST /quotes/:id/expire");
        if (!auth.ok) return true;
        const raw = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        if (!raw) { json(res, 404, { ok: false, error: "Quote not found" }); return true; }
        if (!quotes.canTransition(raw.status, "expired")) { json(res, 409, { ok: false, error: `Only sent quotes can be expired (this quote is ${raw.status})` }); return true; }
        const quote = await quotes.markExpired(auth.context.tenantId, quoteId);
        json(res, 200, { ok: true, quote });
        return true;
      }
      // GET /quotes/:id/pdf — branded quotation PDF (seller letterhead, Bill-To,
      // itemised table with per-unit GST, CGST/SGST summary, bank details, signatures).
      if (sub === "pdf" && req.method === "GET") {
        const auth = await authorize(req, res, "GET /quotes/:id/pdf");
        if (!auth.ok) return true;
        const quote = await quotes.getQuote(auth.context.tenantId, quoteId);
        if (!quote) { json(res, 404, { ok: false, error: "Quote not found" }); return true; }
        const brand = await loadReportBrand(auth.context.tenantId);
        // Bill-To falls back to the linked contact when the letterhead wasn't filled in.
        const billTo = (quote.billTo && Object.keys(quote.billTo).length)
          ? quote.billTo
          : { name: quote.contactName ?? undefined, phone: quote.contactPhone ?? undefined };
        const view = buildQuotationView({
          lineItems: quote.lineItems,
          totalPaise: Number(quote.totalPaise) || 0,
          discountPaise: Number(quote.discountPaise) || 0,
          gstPercent: Number(quote.gstPercent) || 0,
          images: quote.lineImages,
          hsnByGroup: quote.hsn,
          qtyByGroup: quote.qty,
          gstByGroup: quote.gst,
          // Place of supply: explicit ship-to state (else buyer GSTIN) vs seller state
          // decides CGST/SGST vs IGST.
          sellerGstin: quote.seller?.gstin ?? null,
          buyerGstin: quote.billTo?.gstin ?? null,
          placeOfSupplyState: quote.billTo?.stateCode ?? null,
        });
        // Mint the public image token only for a SENT/decided quote (never a draft), and
        // only when the quote has images and a public base URL is configured — so a draft
        // preview PDF never embeds a link that serves its artwork publicly.
        const hasImages = view.items.some((it) => it.imageIndices.length > 0);
        const publicBase = (process.env.EYNIS_PUBLIC_URL ?? "").trim().replace(/\/$/, "");
        let imageLinkBase: string | null = null;
        if (hasImages && publicBase && quote.status !== "draft") {
          const token = await quotes.ensureImageToken(auth.context.tenantId, quoteId);
          if (token) imageLinkBase = `${publicBase}/api/public/quote-image/${token}`;
        }
        const pdf = await renderQuotationPdf({
          number: String(quote.number),
          subject: String(quote.title),
          date: quote.sentAt ? new Date(quote.sentAt as unknown as string) : new Date(quote.createdAt as unknown as string),
          seller: quote.seller,
          billTo,
          view,
          notes: quote.notes as string | null,
          terms: quote.terms as string | null,
          validUntil: quote.validUntil ? new Date(quote.validUntil as unknown as string) : null,
          accentColor: brand.primaryColor,
          brandName: brand.brandName,
          logoUrl: brand.logoUrl,
          imageLinkBase,
        });
        sendBinary(res, "application/pdf", pdf, `quotation-${quote.number}.pdf`);
        return true;
      }
      // GET /quotes/:id/busy-export?format=csv|xml — BUSY-ready sales voucher for an
      // accepted quote (Administration → Import Voucher). File export, no live sync.
      if (sub === "busy-export" && req.method === "GET") {
        const auth = await authorize(req, res, "GET /quotes/:id/busy-export");
        if (!auth.ok) return true;
        const raw = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        if (!raw) { json(res, 404, { ok: false, error: "Quote not found" }); return true; }
        if (raw.status !== "accepted") { json(res, 409, { ok: false, error: "Only accepted quotes can be exported to BUSY" }); return true; }
        const format = (parseUrl(req.url).searchParams.get("format") ?? "csv").toLowerCase();
        const busy = await import("../connectors/busy");
        const config = await busy.resolveBusyConfig(auth.context.tenantId);
        // The quote's own GST rate (if set) wins over the connector default so the
        // voucher matches what the customer was quoted.
        if (raw.gstPercent > 0) config.gstPercent = raw.gstPercent;
        // Party name: linked company, else contact, else the quote title.
        let partyName = raw.title;
        if (raw.companyId) {
          const c = await prisma.company.findFirst({ where: { id: raw.companyId, tenantId: auth.context.tenantId }, select: { name: true } });
          if (c) partyName = c.name;
        } else if (raw.contactId) {
          const c = await prisma.contact.findFirst({ where: { id: raw.contactId, tenantId: auth.context.tenantId }, select: { fullName: true } });
          if (c) partyName = c.fullName;
        }
        const q = { number: raw.number, title: raw.title, acceptedAt: raw.acceptedAt, totalPaise: raw.totalPaise, discountPaise: raw.discountPaise, defaultGstPct: config.gstPercent, gstByGroup: parseGstByGroup(raw.gstRatesJson as string | null | undefined), lineItems: raw.lineItems.map((l) => ({ groupName: l.groupName, lineCostPaise: l.lineCostPaise })) };
        if (format === "xml") {
          sendDoc(res, "application/xml; charset=utf-8", busy.buildBusyXml(q, config, partyName), `busy-voucher-${raw.number}.xml`);
        } else {
          sendDoc(res, "text/csv; charset=utf-8", busy.buildBusyCsv(q, config, partyName), `busy-voucher-${raw.number}.csv`);
        }
        return true;
      }
    }

    
  return false;
}
