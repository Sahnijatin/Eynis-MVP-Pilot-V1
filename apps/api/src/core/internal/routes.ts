// Internal provisioning console router (#164) — the Eynis-staff-only, cross-tenant
// surface (E-8/E-9/E-10): list tenants, the experiment scoreboard (#163), and set a
// tenant's industry / white-label tier / plan / routing domains / sending domain.
// Extracted verbatim from server.ts; returns true when it handled the request,
// false to let the dispatcher continue.
//
// Gated by `requirePlatformAdmin` — the platform-staff secret, NOT tenant RBAC — so
// a customer admin can never reach it. Every mutation is audit-logged.
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { ensureTenantAccess } from "../authz";
import { json, parseBody, parseUrl, asTrimmedString, asPositiveInt } from "../../http/helpers";
import { verifyPlatformAdmin, isPlatformAdminConfigured } from "../platform-admin";
import { isValidIndustry, industryOptions, VALID_INDUSTRIES } from "../industries";
import { isValidTier, tierOptions, WHITELABEL_TIERS } from "../whitelabel";
import { isValidPlan, planOptions, VALID_PLANS, DEFAULT_SEATS_FOR_PLAN, type PlanKey } from "../license";
import { computeScoreboard } from "../analytics/scoreboard";
import { provisionSendingDomain, refreshSendingDomain, isValidSendingDomain, isValidLocalPart } from "../email/domains";

const requirePlatformAdmin = (req: IncomingMessage, res: ServerResponse): boolean => {
  if (!isPlatformAdminConfigured()) {
    json(res, 503, { ok: false, error: "Provisioning console is not configured (PLATFORM_ADMIN_SECRET unset)" });
    return false;
  }
  if (!verifyPlatformAdmin(req)) {
    json(res, 401, { ok: false, error: "Invalid platform admin credentials" });
    return false;
  }
  return true;
};

export async function handleInternalRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const internalPath = parseUrl(req.url).pathname;

  // GET /internal/tenants — list every tenant for the console picker. Optional
  // ?search= matches name / id / slug (case-insensitive).
  if (internalPath === "/internal/tenants" && req.method === "GET") {
    if (!requirePlatformAdmin(req, res)) return true;
    const search = asTrimmedString(parseUrl(req.url).searchParams.get("search"));
    const tenants = await prisma.tenant.findMany({
      where: search
        ? {
            OR: [
              { name: { contains: search, mode: "insensitive" } },
              { id: { contains: search, mode: "insensitive" } },
              { slug: { contains: search, mode: "insensitive" } }
            ]
          }
        : undefined,
      select: { id: true, name: true, industry: true, whitelabelTier: true, slug: true, customDomain: true, createdAt: true, license: { select: { plan: true } } },
      orderBy: { createdAt: "desc" },
      take: 200
    });
    const items = tenants.map(({ license, ...rest }) => ({ ...rest, plan: license?.plan ?? "starter" }));
    json(res, 200, { ok: true, items, industries: industryOptions(), tiers: tierOptions(), plans: planOptions() });
    return true;
  }

  // GET /internal/scoreboard — the experiment scoreboard (#163). Cross-tenant,
  // per-vertical rollup of the five lock-decision metrics (activation, weekly
  // active operators, attributed value, willingness-to-pay, sales-cycle length)
  // so "lock 1 primary vertical + shadow 1" becomes a data call. Staff-only.
  if (internalPath === "/internal/scoreboard" && req.method === "GET") {
    if (!requirePlatformAdmin(req, res)) return true;
    json(res, 200, await computeScoreboard());
    return true;
  }

  // PATCH /internal/tenants/:id/industry — set a tenant's industry.
  const industryMatch = /^\/internal\/tenants\/([^/]+)\/industry$/.exec(internalPath);
  if (industryMatch && req.method === "PATCH") {
    if (!requirePlatformAdmin(req, res)) return true;
    const tenantId = decodeURIComponent(industryMatch[1] as string);
    const body = (await parseBody(req)) as { industry?: unknown; actor?: unknown };
    const industry = asTrimmedString(body.industry);
    if (!industry || !isValidIndustry(industry)) {
      json(res, 400, { ok: false, error: `industry must be one of: ${VALID_INDUSTRIES.join(", ")}` });
      return true;
    }
    const existing = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, industry: true }
    });
    if (!existing) {
      json(res, 404, { ok: false, error: "Tenant not found" });
      return true;
    }
    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: { industry },
      select: { id: true, name: true, industry: true, whitelabelTier: true, slug: true, customDomain: true, createdAt: true }
    });
    // Audit on the affected tenant. `actor` is a free-text label the console can
    // pass to attribute the change to a specific staff member.
    await prisma.auditLog.create({
      data: {
        tenantId,
        actorRole: "platform_staff",
        action: "tenant.industry_changed",
        entityType: "tenant",
        entityId: tenantId,
        metadata: JSON.stringify({
          from: existing.industry,
          to: industry,
          actor: asTrimmedString(body.actor) ?? "platform_console"
        })
      }
    });
    json(res, 200, { ok: true, tenant });
    return true;
  }

  // PATCH /internal/tenants/:id/whitelabel-tier — set a tenant's white-label tier (E-9).
  const tierMatch = /^\/internal\/tenants\/([^/]+)\/whitelabel-tier$/.exec(internalPath);
  if (tierMatch && req.method === "PATCH") {
    if (!requirePlatformAdmin(req, res)) return true;
    const tenantId = decodeURIComponent(tierMatch[1] as string);
    const body = (await parseBody(req)) as { tier?: unknown; actor?: unknown };
    const tier = asTrimmedString(body.tier);
    if (!tier || !isValidTier(tier)) {
      json(res, 400, { ok: false, error: `tier must be one of: ${WHITELABEL_TIERS.join(", ")}` });
      return true;
    }
    const existing = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, whitelabelTier: true }
    });
    if (!existing) {
      json(res, 404, { ok: false, error: "Tenant not found" });
      return true;
    }
    const tenant = await prisma.tenant.update({
      where: { id: tenantId },
      data: { whitelabelTier: tier },
      select: { id: true, name: true, industry: true, whitelabelTier: true, slug: true, customDomain: true, createdAt: true }
    });
    await prisma.auditLog.create({
      data: {
        tenantId,
        actorRole: "platform_staff",
        action: "tenant.whitelabel_tier_changed",
        entityType: "tenant",
        entityId: tenantId,
        metadata: JSON.stringify({
          from: existing.whitelabelTier,
          to: tier,
          actor: asTrimmedString(body.actor) ?? "platform_console"
        })
      }
    });
    json(res, 200, { ok: true, tenant });
    return true;
  }

  // PATCH /internal/tenants/:id/plan — set a tenant's billing plan (which gates
  // features like Research Studio / advanced analytics). Staff-provisioned with
  // NO payment step, so a demo / per-deal instance can be moved to Growth or
  // Enterprise without a Razorpay flow. Upserts the license + audit-logs.
  const planMatch = /^\/internal\/tenants\/([^/]+)\/plan$/.exec(internalPath);
  if (planMatch && req.method === "PATCH") {
    if (!requirePlatformAdmin(req, res)) return true;
    const tenantId = decodeURIComponent(planMatch[1] as string);
    const body = (await parseBody(req)) as { plan?: unknown; maxSeats?: unknown; actor?: unknown };
    const plan = asTrimmedString(body.plan);
    if (!plan || !isValidPlan(plan)) {
      json(res, 400, { ok: false, error: `plan must be one of: ${VALID_PLANS.join(", ")}` });
      return true;
    }
    const existingTenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
    if (!existingTenant) {
      json(res, 404, { ok: false, error: "Tenant not found" });
      return true;
    }
    const existingLicense = await prisma.license.findUnique({ where: { tenantId }, select: { plan: true, maxSeats: true } });
    const fromPlan = existingLicense?.plan ?? "starter";
    // Use an explicit seat count if given; otherwise keep the larger of the
    // current count and the new plan's default (never silently shrink seats).
    const requestedSeats = asPositiveInt(body.maxSeats);
    const maxSeats = requestedSeats ?? Math.max(existingLicense?.maxSeats ?? 0, DEFAULT_SEATS_FOR_PLAN[plan as PlanKey]);
    await prisma.license.upsert({
      where: { tenantId },
      update: { plan, maxSeats },
      create: { tenantId, plan, maxSeats, renewsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) }
    });
    await prisma.auditLog.create({
      data: {
        tenantId,
        actorRole: "platform_staff",
        action: "tenant.plan_changed",
        entityType: "tenant",
        entityId: tenantId,
        metadata: JSON.stringify({ from: fromPlan, to: plan, maxSeats, actor: asTrimmedString(body.actor) ?? "platform_console" })
      }
    });
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, name: true, industry: true, whitelabelTier: true, slug: true, customDomain: true, createdAt: true }
    });
    json(res, 200, { ok: true, tenant: { ...tenant, plan } });
    return true;
  }

  // PATCH /internal/tenants/:id/domains — set a tenant's routing identity
  // (subdomain slug + custom domain). Provider-managed per E-10: customers
  // self-serve their *.eynis.com subdomain, but the custom CNAME domain is set
  // here by staff, who also own the DNS/SSL provisioning for it.
  const domainsMatch = /^\/internal\/tenants\/([^/]+)\/domains$/.exec(internalPath);
  if (domainsMatch && req.method === "PATCH") {
    if (!requirePlatformAdmin(req, res)) return true;
    const tenantId = decodeURIComponent(domainsMatch[1] as string);
    const existing = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { id: true, slug: true, customDomain: true }
    });
    if (!existing) {
      json(res, 404, { ok: false, error: "Tenant not found" });
      return true;
    }
    const body = (await parseBody(req)) as { slug?: unknown; customDomain?: unknown; actor?: unknown };
    const data: { slug?: string | null; customDomain?: string | null } = {};
    if ("slug" in body) {
      const s = asTrimmedString(body.slug)?.toLowerCase() ?? null;
      if (s !== null && !/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(s)) {
        json(res, 400, { ok: false, error: "slug must be 2–32 chars: lowercase letters, numbers, hyphens" });
        return true;
      }
      data.slug = s;
    }
    if ("customDomain" in body) {
      const d = asTrimmedString(body.customDomain)?.toLowerCase() ?? null;
      const platform = (process.env.PLATFORM_APP_DOMAIN ?? "eynis.com").toLowerCase();
      if (d !== null && (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d) || d.endsWith(`.${platform}`) || d === platform)) {
        json(res, 400, { ok: false, error: "customDomain must be a valid hostname on the tenant's own domain (not an eynis.com host)" });
        return true;
      }
      data.customDomain = d;
    }
    if (Object.keys(data).length === 0) {
      json(res, 400, { ok: false, error: "Provide slug and/or customDomain" });
      return true;
    }
    try {
      const tenant = await prisma.tenant.update({
        where: { id: tenantId },
        data,
        select: { id: true, name: true, industry: true, whitelabelTier: true, slug: true, customDomain: true, createdAt: true }
      });
      await prisma.auditLog.create({
        data: {
          tenantId,
          actorRole: "platform_staff",
          action: "tenant.domains_changed",
          entityType: "tenant",
          entityId: tenantId,
          metadata: JSON.stringify({
            from: { slug: existing.slug, customDomain: existing.customDomain },
            to: { slug: tenant.slug, customDomain: tenant.customDomain },
            actor: asTrimmedString(body.actor) ?? "platform_console"
          })
        }
      });
      json(res, 200, { ok: true, tenant });
    } catch (e) {
      if ((e as { code?: string }).code === "P2002") {
        json(res, 409, { ok: false, error: "That slug or domain is already in use" });
        return true;
      }
      throw e;
    }
    return true;
  }

  // ── Sending domain (E-9, white-label Model B) ────────────────────────────
  // GET /internal/tenants/:id/sending-domain — read current config.
  const sdGet = /^\/internal\/tenants\/([^/]+)\/sending-domain$/.exec(internalPath);
  if (sdGet && req.method === "GET") {
    if (!requirePlatformAdmin(req, res)) return true;
    const tenantId = decodeURIComponent(sdGet[1] as string);
    const sd = await prisma.sendingDomain.findUnique({ where: { tenantId } });
    json(res, 200, { ok: true, sendingDomain: sd ? { ...sd, dnsRecords: sd.dnsRecords ? JSON.parse(sd.dnsRecords) : [] } : null });
    return true;
  }

  // PUT /internal/tenants/:id/sending-domain — set/replace the domain. Registers
  // it with the provider (Resend) when a key is present, stores the DNS records
  // the tenant must publish, and resets status to the provider's answer.
  const sdPut = /^\/internal\/tenants\/([^/]+)\/sending-domain$/.exec(internalPath);
  if (sdPut && req.method === "PUT") {
    if (!requirePlatformAdmin(req, res)) return true;
    const tenantId = decodeURIComponent(sdPut[1] as string);
    if (!(await ensureTenantAccess(tenantId))) { json(res, 404, { ok: false, error: "Tenant not found" }); return true; }
    const body = (await parseBody(req)) as { domain?: unknown; fromLocalPart?: unknown; fromName?: unknown; actor?: unknown };
    const domain = asTrimmedString(body.domain)?.toLowerCase() ?? null;
    if (!domain || !isValidSendingDomain(domain)) {
      json(res, 400, { ok: false, error: "domain must be a valid hostname, e.g. mail.acme.com" });
      return true;
    }
    const localPartInput = asTrimmedString(body.fromLocalPart) ?? "notifications";
    if (!isValidLocalPart(localPartInput)) {
      json(res, 400, { ok: false, error: "fromLocalPart must be a valid email local part, e.g. campaigns" });
      return true;
    }
    const fromName = asTrimmedString(body.fromName);
    // If the domain is unchanged and already registered with the provider, don't
    // re-create it (the provider errors on a duplicate, which would wrongly flip
    // the status to "failed") — just re-check its status. Only (re)provision when
    // the domain is new or changed; editing the from-identity alone is fine.
    const existingSd = await prisma.sendingDomain.findUnique({ where: { tenantId } });
    const reuse = existingSd && existingSd.domain === domain && !!existingSd.resendDomainId;
    let resendDomainId: string | null;
    let status: string;
    let dnsRecords: unknown[];
    let live: boolean;
    if (reuse) {
      const refreshed = await refreshSendingDomain(existingSd!.resendDomainId, domain);
      resendDomainId = existingSd!.resendDomainId;
      status = refreshed.status;
      dnsRecords = refreshed.dnsRecords ?? (existingSd!.dnsRecords ? JSON.parse(existingSd!.dnsRecords) : []);
      live = refreshed.live;
    } else {
      const provision = await provisionSendingDomain(domain);
      resendDomainId = provision.resendDomainId;
      status = provision.status;
      dnsRecords = provision.dnsRecords;
      live = provision.live;
    }
    const data = { domain, fromLocalPart: localPartInput, fromName, resendDomainId, status, dnsRecords: JSON.stringify(dnsRecords), lastCheckedAt: new Date() };
    const sd = await prisma.sendingDomain.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
    await prisma.auditLog.create({
      data: {
        tenantId, actorRole: "platform_staff", action: "tenant.sending_domain_set",
        entityType: "sending_domain", entityId: sd.id,
        metadata: JSON.stringify({ domain, status, live, actor: asTrimmedString(body.actor) ?? "platform_console" })
      }
    });
    json(res, 200, { ok: true, sendingDomain: { ...sd, dnsRecords }, live });
    return true;
  }

  // POST /internal/tenants/:id/sending-domain/verify — re-check verification.
  const sdVerify = /^\/internal\/tenants\/([^/]+)\/sending-domain\/verify$/.exec(internalPath);
  if (sdVerify && req.method === "POST") {
    if (!requirePlatformAdmin(req, res)) return true;
    const tenantId = decodeURIComponent(sdVerify[1] as string);
    const existing = await prisma.sendingDomain.findUnique({ where: { tenantId } });
    if (!existing) { json(res, 404, { ok: false, error: "No sending domain configured" }); return true; }
    const result = await refreshSendingDomain(existing.resendDomainId, existing.domain);
    const sd = await prisma.sendingDomain.update({
      where: { tenantId },
      data: {
        status: result.status,
        lastCheckedAt: new Date(),
        ...(result.dnsRecords ? { dnsRecords: JSON.stringify(result.dnsRecords) } : {})
      }
    });
    await prisma.auditLog.create({
      data: {
        tenantId, actorRole: "platform_staff", action: "tenant.sending_domain_verified",
        entityType: "sending_domain", entityId: sd.id,
        metadata: JSON.stringify({ domain: sd.domain, status: result.status, live: result.live })
      }
    });
    json(res, 200, { ok: true, sendingDomain: { ...sd, dnsRecords: sd.dnsRecords ? JSON.parse(sd.dnsRecords) : [] }, live: result.live });
    return true;
  }
  return false;
}
