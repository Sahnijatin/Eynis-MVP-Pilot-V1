// Voice Campaigns domain router (5.1) — extracted verbatim from server.ts. Returns true
// when the request was handled (response written); false lets the main dispatcher
// continue. Authorization goes through the shared authorize()/permissionMap contract.
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { authorize, canAccess, ensureTenantAccess } from "../authz";
import { hasPermission } from "../rbac";
import { isValidConsentSource } from "@eynis/shared";
import { json, parseBody, parseObjectBody, parseRawBody, asTrimmedString, parseUrl, asSafeLimit, asSafeOffset } from "../../http/helpers";

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

const parseCampaignPath = (
  url: string | undefined,
): { id: string; action: string | null } | null => {
  if (!url) return null;
  const { pathname } = parseUrl(url);
  const match = /^\/campaigns\/([^/]+)(?:\/([^/]+))?$/.exec(pathname);
  if (!match || !match[1]) return null;
  const action = match[2] ? decodeURIComponent(match[2]) : null;
  if (action !== null && !CAMPAIGN_ACTIONS.has(action)) return null; // leave /leads, /calls etc. to later phases
  return { id: decodeURIComponent(match[1]), action };
};

// Calls routing: /campaigns/:id/calls, /campaigns/:id/calls/:callId

const CAMPAIGN_ACTIONS = new Set(["activate", "pause", "complete"]);

export async function handleCampaignRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const routePath = parseUrl(req.url).pathname;
  if (!(routePath === "/campaigns" || routePath.startsWith("/campaigns/"))) return false;

    // ── Voice Campaigns: create + list ──────────────────────────────────────
    if (parseUrl(req.url).pathname === "/campaigns" && (req.method === "POST" || req.method === "GET")) {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return true;
      const tenantId = auth.context.tenantId;
      if (!(await ensureTenantAccess(tenantId))) { json(res, 404, { ok: false, error: "Hotel not found" }); return true; }

      const { validateCampaignCreate, serializeCampaign } = await import("./service");

      if (req.method === "POST") {
        if (!canAccess(auth.context.permissions, "POST /campaigns")) {
          json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
        }
        const body = await parseObjectBody(req);
        const validated = validateCampaignCreate(body);
        if (!validated.ok) { json(res, 400, { ok: false, error: validated.error }); return true; }
        const v = validated.value;
        const created = await prisma.voiceCampaign.create({
          data: {
            tenantId, name: v.name, channels: JSON.stringify(v.channels),
            scriptTemplate: v.scriptTemplate,
            outcomeTypes: JSON.stringify(v.outcomeTypes), followUpRules: JSON.stringify(v.followUpRules),
            calendlyLink: v.calendlyLink, agentName: v.agentName,
            whatsappContentSid: v.whatsappContentSid, whatsappTemplateId: v.whatsappTemplateId, whatsappTemplateBody: v.whatsappTemplateBody,
            whatsappVariables: JSON.stringify(v.whatsappVariables),
            whatsappAgentEnabled: v.whatsappAgentEnabled, whatsappAgentPrompt: v.whatsappAgentPrompt,
            emailSubjectTemplate: v.emailSubjectTemplate, emailBodyTemplate: v.emailBodyTemplate,
            maxRetries: v.maxRetries, retryDelayHours: v.retryDelayHours,
            maxConcurrent: v.maxConcurrent, spendCapCalls: v.spendCapCalls, defaultCountryCode: v.defaultCountryCode,
            segmentId: v.segmentId,
            scheduledStartAt: v.scheduledStartAt, sendWindowStartMin: v.sendWindowStartMin,
            sendWindowEndMin: v.sendWindowEndMin, sendDays: JSON.stringify(v.sendDays), sendTimeZone: v.sendTimeZone,
            // Persist the 1..N test arms as child rows.
            variants: v.variants.length > 0 ? {
              create: v.variants.map((vr, i) => ({
                tenantId, key: vr.key, label: vr.label, voice: vr.voice,
                persona: vr.persona, scriptOverride: vr.scriptOverride, weight: vr.weight, sortOrder: i,
              })),
            } : undefined,
          },
          include: { variants: { orderBy: { sortOrder: "asc" } } },
        });
        json(res, 201, { ok: true, campaign: serializeCampaign(created) });
        return true;
      }

      // GET /campaigns — list with lead/call counts
      if (!canAccess(auth.context.permissions, "GET /campaigns")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
      }
      const qs = parseUrl(req.url).searchParams;
      const limit = asSafeLimit(qs.get("limit"), 20, 100);
      const offset = asSafeOffset(qs.get("offset"));
      const [rows, total] = await Promise.all([
        prisma.voiceCampaign.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          take: limit, skip: offset,
          include: { _count: { select: { leads: true, calls: true } } },
        }),
        prisma.voiceCampaign.count({ where: { tenantId } }),
      ]);
      const items = rows.map((r) => ({
        ...serializeCampaign(r),
        stats: { totalLeads: r._count.leads, totalCalls: r._count.calls },
      }));
      json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + items.length < total } });
      return true;
    }

    // ── Voice Campaigns: single / update / delete / lifecycle actions ────────
    if (parseUrl(req.url).pathname.startsWith("/campaigns/")) {
      const parsed = parseCampaignPath(req.url);
      if (parsed) {
        const auth = await authorize(req, res, null);
        if (!auth.ok) return true;
        const tenantId = auth.context.tenantId;
        const { id, action } = parsed;

        const { buildCampaignUpdate, serializeCampaign, outcomeBreakdown, provisionVariantAssistants } =
          await import("./service");

        // Resolve the campaign scoped to this tenant (with its A/B/N variants).
        const campaign = await prisma.voiceCampaign.findFirst({
          where: { id, tenantId },
          include: { variants: { orderBy: { sortOrder: "asc" } } },
        });

        // GET /campaigns/:id
        if (action === null && req.method === "GET") {
          if (!canAccess(auth.context.permissions, "GET /campaigns/:id")) {
            json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
          }
          if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return true; }
          const [leadCount, callCount, outcomeRows, leadStatusRows] = await Promise.all([
            prisma.campaignLead.count({ where: { campaignId: id } }),
            prisma.callRecord.count({ where: { campaignId: id } }),
            prisma.callRecord.groupBy({ by: ["outcome"], where: { campaignId: id }, _count: { _all: true } }),
            prisma.campaignLead.groupBy({ by: ["status"], where: { campaignId: id }, _count: { _all: true } }),
          ]);
          json(res, 200, {
            ok: true,
            campaign: serializeCampaign(campaign),
            stats: {
              totalLeads: leadCount,
              totalCalls: callCount,
              outcomeBreakdown: outcomeBreakdown(outcomeRows.map((o) => ({ outcome: o.outcome, count: o._count._all }))),
              leadStatusBreakdown: Object.fromEntries(leadStatusRows.map((s) => [s.status, s._count._all])),
            },
          });
          return true;
        }

        // PATCH /campaigns/:id
        if (action === null && req.method === "PATCH") {
          if (!canAccess(auth.context.permissions, "PATCH /campaigns/:id")) {
            json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
          }
          if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return true; }
          const body = await parseObjectBody(req);
          const editsVariants = body.variants !== undefined;
          const update = buildCampaignUpdate(body);
          // Tolerate a variants-only PATCH (buildCampaignUpdate has no other fields to apply).
          if (!update.ok && !editsVariants) { json(res, 400, { ok: false, error: update.error }); return true; }
          // Variant edits are only allowed before the campaign goes live, since
          // assistants are provisioned (and leads assigned) on activation.
          if (editsVariants) {
            if (campaign.status !== "draft") {
              json(res, 409, { ok: false, error: "Variants can only be changed while the campaign is a draft" }); return true;
            }
            const { validateVariants } = await import("./service");
            const voice = (serializeCampaign(campaign).channels as string[]).includes("voice");
            const v = validateVariants(body.variants, { requireVoice: voice });
            if (!v.ok) { json(res, 400, { ok: false, error: v.error }); return true; }
            await prisma.campaignVariant.deleteMany({ where: { campaignId: id } });
            await prisma.$transaction(v.value.map((vr, i) => prisma.campaignVariant.create({
              data: { campaignId: id, tenantId, key: vr.key, label: vr.label, voice: vr.voice, persona: vr.persona, scriptOverride: vr.scriptOverride, weight: vr.weight, sortOrder: i },
            })));
          }
          if (update.ok) await prisma.voiceCampaign.update({ where: { id }, data: update.value });
          const refreshed = await prisma.voiceCampaign.findFirst({ where: { id }, include: { variants: { orderBy: { sortOrder: "asc" } } } });
          json(res, 200, { ok: true, campaign: serializeCampaign(refreshed!) });
          return true;
        }

        // DELETE /campaigns/:id — only when no CallRecords exist
        if (action === null && req.method === "DELETE") {
          if (!canAccess(auth.context.permissions, "DELETE /campaigns/:id")) {
            json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
          }
          if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return true; }
          const callCount = await prisma.callRecord.count({ where: { campaignId: id } });
          if (callCount > 0) {
            json(res, 409, { ok: false, error: "Cannot delete a campaign with call records; complete it instead" });
            return true;
          }
          await prisma.voiceCampaign.delete({ where: { id } });
          json(res, 200, { ok: true, deleted: id });
          return true;
        }

        // POST /campaigns/:id/activate | pause | complete
        if (action !== null && req.method === "POST") {
          if (!canAccess(auth.context.permissions, `POST /campaigns/:id/${action}`)) {
            json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
          }
          if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return true; }

          if (action === "pause") {
            if (campaign.status !== "active") {
              json(res, 409, { ok: false, error: `Cannot pause a campaign in '${campaign.status}' status` }); return true;
            }
            const updated = await prisma.voiceCampaign.update({ where: { id }, data: { status: "paused" } });
            json(res, 200, { ok: true, campaign: serializeCampaign(updated) });
            return true;
          }

          if (action === "complete") {
            if (campaign.status === "completed") {
              json(res, 409, { ok: false, error: "Campaign is already completed" }); return true;
            }
            const updated = await prisma.voiceCampaign.update({ where: { id }, data: { status: "completed" } });
            json(res, 200, { ok: true, campaign: serializeCampaign(updated) });
            return true;
          }

          // action === "activate"
          if (campaign.status !== "draft" && campaign.status !== "paused") {
            json(res, 409, { ok: false, error: `Cannot activate a campaign in '${campaign.status}' status` }); return true;
          }
          const channels = serializeCampaign(campaign).channels as string[];
          // WhatsApp: cannot activate without an approved template (Meta forbids
          // business-initiated sends on anything but a pre-approved template).
          if (channels.includes("whatsapp")) {
            const { isApprovedWhatsappTemplate } = await import("./whatsapp-template");
            const tpl = campaign.whatsappTemplateId
              ? await prisma.messageTemplate.findFirst({ where: { id: campaign.whatsappTemplateId, tenantId }, select: { channel: true, status: true, providerTemplateId: true } })
              : null;
            if (!isApprovedWhatsappTemplate(tpl)) {
              json(res, 400, { ok: false, error: "WhatsApp campaigns need an approved template. Get one approved in Templates, then select it in the campaign's settings." });
              return true;
            }
          }
          const variantRows = campaign.variants;
          // Voice channel: provision a Vapi assistant per variant. Non-voice
          // channels (WhatsApp/email) need no provisioning and activate directly.
          if (channels.includes("voice")) {
            if (variantRows.length === 0) {
              json(res, 400, { ok: false, error: "Add at least one voice variant before activating" });
              return true;
            }
            const { resolveVapiCredentials, isVapiConfigured, createAssistant, deleteAssistant, webhookHostFromPublicUrl } = await import("./vapi");
            const creds = await resolveVapiCredentials(tenantId);
            if (!isVapiConfigured(creds)) {
              json(res, 400, { ok: false, error: "voice_vapi connector not configured — set VAPI_API_KEY or enable the connector" });
              return true;
            }
            // Provision only the arms not already provisioned (resume keeps existing).
            const unprovisioned = variantRows.filter((v) => !v.vapiAssistantId);
            if (unprovisioned.length > 0) {
              // Webhook callback host MUST come from trusted server config, never the
              // request Host header (which a caller can spoof to exfiltrate call reports).
              const apiDomain = webhookHostFromPublicUrl(process.env.API_PUBLIC_URL);
              if (!apiDomain) {
                json(res, 500, { ok: false, error: "Server misconfigured: set API_PUBLIC_URL (e.g. https://api.example.com) for the Vapi webhook callback" });
                return true;
              }
              // Agent name the AI introduces itself with: explicit campaign value,
              // else the hotel name (never the persona label).
              const hotel = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
              const agentName = asTrimmedString(campaign.agentName) ?? hotel?.name ?? "your assistant";
              const provisioned = await provisionVariantAssistants({
                campaign: {
                  name: campaign.name, scriptTemplate: campaign.scriptTemplate ?? "",
                  outcomeTypes: serializeCampaign(campaign).outcomeTypes,
                },
                variants: unprovisioned.map((v) => ({ key: v.key, label: v.label, voice: v.voice, persona: v.persona, scriptOverride: v.scriptOverride })),
                creds, apiDomain, agentName,
                createAssistant, deleteAssistant,
              });
              if (!provisioned.ok) { json(res, 502, { ok: false, error: provisioned.error }); return true; }
              await prisma.$transaction(
                Object.entries(provisioned.assistants).map(([key, assistantId]) =>
                  prisma.campaignVariant.update({ where: { campaignId_key: { campaignId: id, key } }, data: { vapiAssistantId: assistantId } })),
              );
            }
          }
          const updated = await prisma.voiceCampaign.update({
            where: { id },
            data: { status: "active" },
            include: { variants: { orderBy: { sortOrder: "asc" } } },
          });
          json(res, 200, { ok: true, campaign: serializeCampaign(updated) });
          return true;
        }
      }
    }

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
