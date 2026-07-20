// Voice Campaigns domain router (5.1) — extracted verbatim from server.ts. Returns true
// when the request was handled (response written); false lets the main dispatcher
// continue. Authorization goes through the shared authorize()/permissionMap contract.
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { authorize, canAccess, ensureTenantAccess } from "../authz";
import { json, parseObjectBody, asTrimmedString, parseUrl, asSafeLimit, asSafeOffset } from "../../http/helpers";


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

    // ── GDPR/DPDP erasure (Phase 8) ──────────────────────────────────────────
    // Shreds a person's PII across every campaign surface (rows kept so
    // aggregates stay truthful) and DNC-suppresses their phone first. Declared
    // before the /campaigns/:id matchers so "erasure" is never read as an id.
    if (routePath === "/campaigns/erasure" && req.method === "POST") {
      const auth = await authorize(req, res, "POST /campaigns/erasure");
      if (!auth.ok) return true;
      const body = await parseObjectBody(req);
      const { eraseCampaignLeadPII } = await import("./erasure");
      const result = await eraseCampaignLeadPII(auth.context.tenantId, {
        leadId: asTrimmedString(body.leadId),
        phone: asTrimmedString(body.phone),
        email: asTrimmedString(body.email),
      }, auth.context.userId);
      if (!result.ok) { json(res, result.status, { ok: false, error: result.error }); return true; }
      json(res, 200, { ok: true, counts: result.counts });
      return true;
    }

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



  return false;
}
