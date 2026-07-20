// Voice-campaign sub-resources sub-router (#164) — the per-campaign lead,
// analytics, deliveries and calls surface, split out of core/campaigns/routes.ts so
// no routing file exceeds ~600 lines. Extracted verbatim; returns true when it
// handled the request, false otherwise. Dispatched AFTER handleCampaignRoutes — the
// core /campaigns/:id matcher already excludes these sub-resource actions.
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { authorize, canAccess } from "../authz";
import { isValidConsentSource } from "@eynis/shared";
import { json, parseObjectBody, asTrimmedString, parseUrl, asSafeLimit, asSafeOffset } from "../../http/helpers";

const parseCampaignCallsPath = (
  url: string | undefined,
): { campaignId: string; callId: string | null } | null => {
  if (!url) return null;
  const match = /^\/campaigns\/([^/]+)\/calls(?:\/([^/]+))?$/.exec(parseUrl(url).pathname);
  if (!match || !match[1]) return null;
  return { campaignId: decodeURIComponent(match[1]), callId: match[2] ? decodeURIComponent(match[2]) : null };
};

// Analytics routing: /campaigns/:id/analytics
const parseCampaignAnalyticsPath = (url: string | undefined): string | null => {
  if (!url) return null;
  const match = /^\/campaigns\/([^/]+)\/analytics$/.exec(parseUrl(url).pathname);
  return match && match[1] ? decodeURIComponent(match[1]) : null;
};

// Deliveries routing: /campaigns/:id/deliveries  (messaging activity feed)
const parseCampaignDeliveriesPath = (url: string | undefined): string | null => {
  if (!url) return null;
  const match = /^\/campaigns\/([^/]+)\/deliveries$/.exec(parseUrl(url).pathname);
  return match && match[1] ? decodeURIComponent(match[1]) : null;
};

// Segments routing: /segments, /segments/:id, /segments/:id/preview
const parseCampaignLeadsPath = (
  url: string | undefined,
): { campaignId: string; leadId: string | null; isImport: boolean } | null => {
  if (!url) return null;
  const { pathname } = parseUrl(url);
  const match = /^\/campaigns\/([^/]+)\/leads(?:\/([^/]+))?$/.exec(pathname);
  if (!match || !match[1]) return null;
  const sub = match[2] ? decodeURIComponent(match[2]) : null;
  return { campaignId: decodeURIComponent(match[1]), leadId: sub === "import" ? null : sub, isImport: sub === "import" };
};

export async function handleCampaignSubRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const routePath = parseUrl(req.url).pathname;
  if (!routePath.startsWith("/campaigns/")) return false;

  // ── Voice Campaign leads: import / list / delete ────────────────────────
  const leadsPath = parseCampaignLeadsPath(req.url);
  if (leadsPath) {
    const auth = await authorize(req, res, null);
    if (!auth.ok) return true;
    const tenantId = auth.context.tenantId;
    const { campaignId, leadId, isImport } = leadsPath;
    const campaign = await prisma.voiceCampaign.findFirst({
      where: { id: campaignId, tenantId },
      select: { id: true, defaultCountryCode: true },
    });

    // POST /campaigns/:id/leads/import  (multipart CSV)
    if (isImport && req.method === "POST") {
      if (!canAccess(auth.context.permissions, "POST /campaigns/:id/leads/import")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
      }
      if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return true; }

      const { parseMultipart, parseLeadsFromCsv, bulkInsertLeads } = await import("./csv-import");
      let multipart;
      try { multipart = await parseMultipart(req); }
      catch (e) { json(res, 400, { ok: false, error: `Invalid upload: ${(e as Error).message}` }); return true; }
      if (!multipart.file) { json(res, 400, { ok: false, error: "CSV file is required (form field 'file')" }); return true; }

      let columnMap: unknown;
      try { columnMap = JSON.parse(multipart.fields.columnMap ?? "{}"); }
      catch { json(res, 400, { ok: false, error: "columnMap must be valid JSON" }); return true; }
      if (typeof columnMap !== "object" || columnMap === null || Array.isArray(columnMap)) {
        json(res, 400, { ok: false, error: "columnMap must be a JSON object mapping CSV headers to fields" }); return true;
      }

      const consentSourceRaw = asTrimmedString(multipart.fields.consentSource);
      const consentSource = consentSourceRaw && isValidConsentSource(consentSourceRaw) ? consentSourceRaw : undefined;
      const csvText = multipart.file.content.toString("utf8");
      const { leads, errors } = parseLeadsFromCsv(csvText, {
        columnMap: columnMap as Record<string, import("./csv-import").EynisLeadField>,
        defaultCountryCode: campaign.defaultCountryCode,
        defaultConsent: multipart.fields.defaultConsent === "true",
        consentSource,
      });
      const result = await bulkInsertLeads(campaignId, tenantId, leads, errors);
      // Roll imported leads up to durable Contacts (CRM hub) — idempotent.
      const { backfillContactsFromLeads } = await import("../crm/contacts");
      await backfillContactsFromLeads(tenantId);
      json(res, 200, { ok: true, ...result });
      return true;
    }

    // GET /campaigns/:id/leads  (paginated; ?status= &abVariant=)
    if (leadId === null && !isImport && req.method === "GET") {
      if (!canAccess(auth.context.permissions, "GET /campaigns/:id/leads")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
      }
      if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return true; }
      const qs = parseUrl(req.url).searchParams;
      const limit = asSafeLimit(qs.get("limit"), 50, 200);
      const offset = asSafeOffset(qs.get("offset"));
      const status = asTrimmedString(qs.get("status"));
      const abVariant = asTrimmedString(qs.get("abVariant"));
      const tag = asTrimmedString(qs.get("tag"));
      const segmentId = asTrimmedString(qs.get("segmentId"));
      // Optional segment filter: apply the saved rules (tenant-scoped).
      let segmentWhere = {};
      if (segmentId) {
        const seg = await prisma.leadSegment.findFirst({ where: { id: segmentId, tenantId }, select: { rules: true } });
        if (seg) {
          const { parseSegmentRules, buildLeadWhere } = await import("./segments");
          segmentWhere = buildLeadWhere(parseSegmentRules(seg.rules));
        }
      }
      const where = {
        campaignId,
        ...(status ? { status } : {}),
        ...(abVariant ? { abVariant } : {}),
        ...(tag ? { tags: { has: tag } } : {}),
        ...segmentWhere,
      };
      const [items, total] = await Promise.all([
        prisma.campaignLead.findMany({
          where, orderBy: { createdAt: "desc" }, take: limit, skip: offset,
          select: {
            id: true, firstName: true, lastName: true, phone: true, email: true,
            company: true, jobTitle: true, abVariant: true, status: true, tags: true,
            callAttempts: true, consent: true, optedOut: true, createdAt: true,
          },
        }),
        prisma.campaignLead.count({ where }),
      ]);
      json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + items.length < total } });
      return true;
    }

    // POST /campaigns/:id/leads/tag — bulk add/remove tags on selected leads.
    // ("tag" is a reserved sub-path; lead ids are cuids and never collide.)
    if (leadId === "tag" && req.method === "POST") {
      if (!canAccess(auth.context.permissions, "GET /campaigns/:id/leads")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
      }
      if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return true; }
      const body = await parseObjectBody(req);
      const { normalizeTags } = await import("./segments");
      const leadIds = Array.isArray(body.leadIds) ? body.leadIds.filter((x): x is string => typeof x === "string") : [];
      const addTags = normalizeTags(body.addTags);
      const removeTags = normalizeTags(body.removeTags);
      if (leadIds.length === 0) { json(res, 400, { ok: false, error: "leadIds must be a non-empty array" }); return true; }
      if (addTags.length === 0 && removeTags.length === 0) { json(res, 400, { ok: false, error: "provide addTags and/or removeTags" }); return true; }
      // Read-modify-write per lead so tag sets stay deduped and ordered.
      const targets = await prisma.campaignLead.findMany({ where: { id: { in: leadIds }, campaignId, tenantId }, select: { id: true, tags: true } });
      let updated = 0;
      for (const t of targets) {
        const next = normalizeTags([...t.tags.filter((x) => !removeTags.includes(x)), ...addTags]);
        await prisma.campaignLead.update({ where: { id: t.id }, data: { tags: next } });
        updated++;
      }
      json(res, 200, { ok: true, updated });
      return true;
    }

    // PATCH /campaigns/:id/leads/:leadId — set the lead's tags (full replace).
    if (leadId !== null && leadId !== "tag" && !isImport && req.method === "PATCH") {
      if (!canAccess(auth.context.permissions, "GET /campaigns/:id/leads")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
      }
      if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return true; }
      const body = await parseObjectBody(req);
      if (body.tags === undefined) { json(res, 400, { ok: false, error: "tags is required" }); return true; }
      const { normalizeTags } = await import("./segments");
      const lead = await prisma.campaignLead.findFirst({ where: { id: leadId, campaignId, tenantId }, select: { id: true } });
      if (!lead) { json(res, 404, { ok: false, error: "Lead not found" }); return true; }
      const updated = await prisma.campaignLead.update({ where: { id: lead.id }, data: { tags: normalizeTags(body.tags) }, select: { id: true, tags: true } });
      json(res, 200, { ok: true, lead: updated });
      return true;
    }

    // DELETE /campaigns/:id/leads/:leadId  (pending only)
    if (leadId !== null && !isImport && req.method === "DELETE") {
      if (!canAccess(auth.context.permissions, "DELETE /campaigns/:id/leads/:leadId")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
      }
      if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return true; }
      const lead = await prisma.campaignLead.findFirst({ where: { id: leadId, campaignId, tenantId }, select: { id: true, status: true } });
      if (!lead) { json(res, 404, { ok: false, error: "Lead not found" }); return true; }
      if (lead.status !== "pending") {
        json(res, 409, { ok: false, error: "Only pending leads can be removed" }); return true;
      }
      await prisma.campaignLead.delete({ where: { id: leadId } });
      json(res, 200, { ok: true, deleted: leadId });
      return true;
    }
  }

  // ── Voice Campaign: A/B analytics ───────────────────────────────────────
  const analyticsId = parseCampaignAnalyticsPath(req.url);
  if (analyticsId && req.method === "GET") {
    const auth = await authorize(req, res, "GET /campaigns/:id/analytics");
    if (!auth.ok) return true;
    const campaign = await prisma.voiceCampaign.findFirst({
      where: { id: analyticsId, tenantId: auth.context.tenantId },
      select: { id: true, variants: { orderBy: { sortOrder: "asc" }, select: { key: true, label: true } } },
    });
    if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return true; }

    const rows = await prisma.callRecord.findMany({
      where: { campaignId: analyticsId },
      select: { abVariant: true, status: true, outcome: true, durationSeconds: true, sentiment: true, meetingBooked: true },
    });
    const { summarizeVariant, decideLeaderN, sentimentScore } = await import("./analytics");
    const armDefs = campaign.variants.map((v) => ({ key: v.key, label: v.label }));
    const NO_ANSWER = new Set(["no_answer"]);
    const blank = () => ({ dials: 0, answered: 0, interested: 0, meetingsBooked: 0, durationSum: 0, durationCount: 0, sentimentScoreSum: 0, sentimentRatedCount: 0 });
    const acc: Record<string, ReturnType<typeof blank>> = {};
    for (const arm of armDefs) acc[arm.key] = blank();
    for (const r of rows) {
      const v = acc[r.abVariant];
      if (!v) continue;
      v.dials++;
      if (r.status === "ended" && r.outcome && !NO_ANSWER.has(r.outcome)) v.answered++;
      if (r.outcome === "interested") v.interested++;
      if (r.meetingBooked) v.meetingsBooked++;
      if (r.status === "ended" && r.durationSeconds != null) { v.durationSum += r.durationSeconds; v.durationCount++; }
      if (r.sentiment) { v.sentimentScoreSum += sentimentScore(r.sentiment); v.sentimentRatedCount++; }
    }
    const toRaw = (v: ReturnType<typeof blank>) => ({
      dials: v.dials, answered: v.answered, interested: v.interested, meetingsBooked: v.meetingsBooked,
      avgDurationSeconds: v.durationCount > 0 ? Math.round(v.durationSum / v.durationCount) : null,
      sentimentScoreSum: v.sentimentScoreSum, sentimentRatedCount: v.sentimentRatedCount,
    });
    const variants = armDefs.map((arm) => ({ key: arm.key, label: arm.label, ...summarizeVariant(toRaw(acc[arm.key]!)) }));
    const decision = decideLeaderN(variants.map((v) => ({ key: v.key, stats: v })));
    const overall = {
      totalLeads: await prisma.campaignLead.count({ where: { campaignId: analyticsId } }),
      dials: variants.reduce((s, v) => s + v.dials, 0),
      answered: variants.reduce((s, v) => s + v.answered, 0),
      interested: variants.reduce((s, v) => s + v.interested, 0),
      meetingsBooked: variants.reduce((s, v) => s + v.meetingsBooked, 0),
    };
    // Back-compat: expose the first two arms as variantA/variantB for older clients.
    const variantA = variants.find((v) => v.key === "A") ?? variants[0] ?? null;
    const variantB = variants.find((v) => v.key === "B") ?? variants[1] ?? null;
    json(res, 200, { ok: true, overall, variants, variantA, variantB, ...decision });
    return true;
  }

  // ── Voice Campaign: message deliveries (activity feed) ──────────────────
  // Surfaces WhatsApp/email sends (MessageDelivery) for a campaign so the UI
  // can render a live activity feed. Paginated, newest first, optional
  // ?channel= and ?status= filters. Tenant-scoped via the campaign lookup.
  const deliveriesId = parseCampaignDeliveriesPath(req.url);
  if (deliveriesId && req.method === "GET") {
    const auth = await authorize(req, res, "GET /campaigns/:id/deliveries");
    if (!auth.ok) return true;
    const campaign = await prisma.voiceCampaign.findFirst({ where: { id: deliveriesId, tenantId: auth.context.tenantId }, select: { id: true } });
    if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return true; }

    const qs = parseUrl(req.url).searchParams;
    const whereDeliveries = {
      campaignId: deliveriesId,
      ...(asTrimmedString(qs.get("channel")) ? { channel: asTrimmedString(qs.get("channel"))! } : {}),
      ...(asTrimmedString(qs.get("status")) ? { status: asTrimmedString(qs.get("status"))! } : {}),
    };
    const limit = asSafeLimit(qs.get("limit"), 50, 200);
    const offset = asSafeOffset(qs.get("offset"));
    const [items, total] = await Promise.all([
      prisma.messageDelivery.findMany({
        where: whereDeliveries, orderBy: { createdAt: "desc" }, take: limit, skip: offset,
        select: {
          id: true, channel: true, status: true, renderedSubject: true, renderedBody: true,
          error: true, sentAt: true, createdAt: true,
          lead: { select: { firstName: true, lastName: true, company: true, phone: true } },
        },
      }),
      prisma.messageDelivery.count({ where: whereDeliveries }),
    ]);
    json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + items.length < total } });
    return true;
  }

  // ── Voice Campaign: calls list / detail (+ CSV export) ──────────────────
  const callsPath = parseCampaignCallsPath(req.url);
  if (callsPath && req.method === "GET") {
    // Permission BEFORE the campaign lookup: an under-permissioned caller must
    // get a uniform 403, never a 404 that confirms whether a campaign id exists.
    const auth = await authorize(req, res, callsPath.callId ? "GET /campaigns/:id/calls/:callId" : "GET /campaigns/:id/calls");
    if (!auth.ok) return true;
    const tenantId = auth.context.tenantId;
    const campaign = await prisma.voiceCampaign.findFirst({ where: { id: callsPath.campaignId, tenantId }, select: { id: true } });
    if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return true; }

    // Single call detail: + sentiment timeline + the lead's WhatsApp thread.
    if (callsPath.callId) {
      const call = await prisma.callRecord.findFirst({
        where: { id: callsPath.callId, campaignId: callsPath.campaignId },
        include: { lead: { select: { id: true, firstName: true, lastName: true, company: true, phone: true } } },
      });
      if (!call) { json(res, 404, { ok: false, error: "Call not found" }); return true; }
      const [sentimentEvents, conversation] = await Promise.all([
        prisma.sentimentEvent.findMany({ where: { callRecordId: call.id }, orderBy: { createdAt: "asc" }, select: { speaker: true, text: true, sentiment: true, score: true, createdAt: true } }),
        prisma.whatsappConversation.findFirst({ where: { campaignId: callsPath.campaignId, leadId: call.leadId }, include: { messages: { orderBy: { createdAt: "asc" }, select: { direction: true, body: true, sentiment: true, createdAt: true } } } }),
      ]);
      json(res, 200, { ok: true, call: { ...call, keyPoints: (() => { try { return JSON.parse(call.keyPoints); } catch { return []; } })() }, sentimentEvents, whatsappThread: conversation?.messages ?? [] });
      return true;
    }

    // List
    const qs = parseUrl(req.url).searchParams;
    const whereCalls = {
      campaignId: callsPath.campaignId,
      ...(asTrimmedString(qs.get("outcome")) ? { outcome: asTrimmedString(qs.get("outcome"))! } : {}),
      ...(asTrimmedString(qs.get("abVariant")) ? { abVariant: asTrimmedString(qs.get("abVariant"))! } : {}),
    };
    const selectCall = {
      id: true, abVariant: true, status: true, outcome: true, sentiment: true, durationSeconds: true,
      whatsappSent: true, emailSent: true, meetingBooked: true, createdAt: true, endedAt: true,
      lead: { select: { firstName: true, lastName: true, company: true, phone: true } },
    };

    // CSV export — full set (no pagination), Content-Disposition.
    if (qs.get("format") === "csv") {
      const all = await prisma.callRecord.findMany({ where: whereCalls, orderBy: { createdAt: "desc" }, select: selectCall });
      const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
      const header = ["name", "company", "phone", "variant", "status", "outcome", "sentiment", "durationSeconds", "whatsappSent", "emailSent", "meetingBooked", "createdAt"];
      const lines = [header.join(",")];
      for (const c of all) {
        lines.push([
          `${c.lead.firstName} ${c.lead.lastName ?? ""}`.trim(), c.lead.company ?? "", c.lead.phone ?? "",
          c.abVariant, c.status, c.outcome ?? "", c.sentiment ?? "", c.durationSeconds ?? "",
          c.whatsappSent, c.emailSent, c.meetingBooked, c.createdAt.toISOString(),
        ].map(esc).join(","));
      }
      res.writeHead(200, { "content-type": "text/csv", "content-disposition": `attachment; filename="campaign-${callsPath.campaignId}-calls.csv"` });
      res.end(lines.join("\n"));
      return true;
    }

    const limit = asSafeLimit(qs.get("limit"), 50, 200);
    const offset = asSafeOffset(qs.get("offset"));
    const [items, total] = await Promise.all([
      prisma.callRecord.findMany({ where: whereCalls, orderBy: { createdAt: "desc" }, take: limit, skip: offset, select: selectCall }),
      prisma.callRecord.count({ where: whereCalls }),
    ]);
    json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + items.length < total } });
    return true;
  }
  return false;
}
