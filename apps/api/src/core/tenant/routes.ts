// Tenant/self settings router (#164) — everything the signed-in user reads or
// edits about themselves and their tenant: auth context, own profile, own bell
// preferences, the notification feed, and the tenant profile / branding / domains
// settings. Extracted verbatim from server.ts; returns true when it handled the
// request, false to let the dispatcher continue.
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { authorize, canAccess, ensureTenantAccess } from "../authz";
import { json, parseBody, asTrimmedString } from "../../http/helpers";
import { BRANDING_SELECT, sanitizeBranding } from "./branding";

// Per-user notification bell preferences. null/invalid → all categories enabled.
type NotificationPrefs = { escalations: boolean; inventory: boolean; quotes: boolean };
const parseNotificationPrefs = (raw: string | null): NotificationPrefs => {
  const all: NotificationPrefs = { escalations: true, inventory: true, quotes: true };
  if (!raw) return all;
  try {
    const p = JSON.parse(raw) as Partial<NotificationPrefs>;
    return {
      escalations: typeof p.escalations === "boolean" ? p.escalations : true,
      inventory: typeof p.inventory === "boolean" ? p.inventory : true,
      quotes: typeof p.quotes === "boolean" ? p.quotes : true,
    };
  } catch {
    return all;
  }
};

export async function handleTenantMeRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.url === "/context" && req.method === "GET") {
    const auth = await authorize(req, res, null);
    if (!auth.ok) return true;

    const hasAccess = await ensureTenantAccess(auth.context.tenantId);
    if (!hasAccess) {
      json(res, 403, { ok: false, error: "Hotel not found or access denied" });
      return true;
    }

    if (!canAccess(auth.context.permissions, "GET /context")) {
      json(res, 403, { ok: false, error: "Insufficient permissions" });
      return true;
    }
    json(res, 200, { ok: true, context: auth.context });
    return true;
  }

  // ── PATCH /me — the signed-in user updates their own basic profile ──────────
  // Any authenticated user may edit their own display name. Email is the login
  // identity (managed by the auth provider) and is intentionally not editable here.
  if (req.url === "/me" && req.method === "PATCH") {
    const auth = await authorize(req, res, null);
    if (!auth.ok) return true;
    const body = (await parseBody(req)) as { fullName?: unknown };
    const fullName = asTrimmedString(body.fullName);
    if (!fullName) { json(res, 400, { ok: false, error: "Full name cannot be empty" }); return true; }
    const updated = await prisma.user.update({
      where: { id: auth.context.userId },
      data: { fullName },
      select: { id: true, fullName: true },
    });
    json(res, 200, { ok: true, user: updated });
    return true;
  }

  // ── GET/PATCH /me/notifications — per-user bell notification preferences ─────
  // These map 1:1 to the categories the top-bar bell (GET /notifications) can
  // show, so toggling one genuinely hides/shows that category for this user.
  if (req.url === "/me/notifications" && (req.method === "GET" || req.method === "PATCH")) {
    const auth = await authorize(req, res, null);
    if (!auth.ok) return true;
    const userId = auth.context.userId;

    if (req.method === "GET") {
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
      json(res, 200, { ok: true, prefs: parseNotificationPrefs(u?.notificationPrefs ?? null) });
      return true;
    }
    // PATCH — merge the provided booleans onto the current prefs.
    const body = (await parseBody(req)) as Record<string, unknown>;
    const u = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
    const current = parseNotificationPrefs(u?.notificationPrefs ?? null);
    const next = {
      escalations: typeof body.escalations === "boolean" ? body.escalations : current.escalations,
      inventory: typeof body.inventory === "boolean" ? body.inventory : current.inventory,
      quotes: typeof body.quotes === "boolean" ? body.quotes : current.quotes,
    };
    await prisma.user.update({ where: { id: userId }, data: { notificationPrefs: JSON.stringify(next) } });
    json(res, 200, { ok: true, prefs: next });
    return true;
  }

  // ── Tenant profile (property details shown in Settings) ─────────────────────
  if (req.url === "/tenant/profile" && (req.method === "GET" || req.method === "PATCH")) {
    const auth = await authorize(req, res, null);
    if (!auth.ok) return true;
    const { tenantId, permissions } = auth.context;
    if (!(await ensureTenantAccess(tenantId))) {
      json(res, 403, { ok: false, error: "Tenant not found or access denied" });
      return true;
    }
    if (!canAccess(permissions, `${req.method} /tenant/profile`)) {
      json(res, 403, { ok: false, error: "Insufficient permissions" });
      return true;
    }

    if (req.method === "GET") {
      const t = await prisma.tenant.findUnique({
        where: { id: tenantId },
        select: { name: true, timezone: true, address: true, phone: true },
      });
      json(res, 200, { ok: true, profile: t });
      return true;
    }

    // PATCH — update property details. Only fields present in the body change.
    const body = (await parseBody(req)) as { name?: unknown; timezone?: unknown; address?: unknown; phone?: unknown };
    const data: { name?: string; timezone?: string; address?: string | null; phone?: string | null } = {};
    if (body.name !== undefined) {
      const name = asTrimmedString(body.name);
      if (!name) { json(res, 400, { ok: false, error: "Property name cannot be empty" }); return true; }
      data.name = name;
    }
    if (body.timezone !== undefined) {
      const tz = asTrimmedString(body.timezone);
      if (!tz) { json(res, 400, { ok: false, error: "Timezone cannot be empty" }); return true; }
      data.timezone = tz;
    }
    if (body.address !== undefined) data.address = asTrimmedString(body.address);
    if (body.phone !== undefined) data.phone = asTrimmedString(body.phone);
    const t = await prisma.tenant.update({
      where: { id: tenantId },
      data,
      select: { name: true, timezone: true, address: true, phone: true },
    });
    json(res, 200, { ok: true, profile: t });
    return true;
  }

  // ── Tenant branding (white-label) ───────────────────────────────────────────
  if (req.url === "/tenant/branding" && (req.method === "GET" || req.method === "PUT")) {
    const auth = await authorize(req, res, null);
    if (!auth.ok) return true;
    const { tenantId, permissions } = auth.context;
    if (!(await ensureTenantAccess(tenantId))) {
      json(res, 403, { ok: false, error: "Hotel not found or access denied" });
      return true;
    }
    if (!canAccess(permissions, `${req.method} /tenant/branding`)) {
      json(res, 403, { ok: false, error: "Insufficient permissions" });
      return true;
    }

    if (req.method === "GET") {
      const [branding, tenant] = await Promise.all([
        prisma.tenantBranding.findUnique({ where: { tenantId }, select: BRANDING_SELECT }),
        prisma.tenant.findUnique({ where: { id: tenantId }, select: { whitelabelTier: true } }),
      ]);
      // The tier is read-only here (set via the provisioning console) — the panel
      // uses it to gate which white-label controls a tenant may edit (E-9).
      json(res, 200, { ok: true, branding: branding ?? null, whitelabelTier: tenant?.whitelabelTier ?? "standard" });
      return true;
    }

    // PUT — upsert this tenant's branding (partial overrides; blanks reset to default).
    const data = sanitizeBranding((await parseBody(req)) as Record<string, unknown>);
    const branding = await prisma.tenantBranding.upsert({
      where: { tenantId },
      create: { tenantId, ...data },
      update: data,
      select: BRANDING_SELECT,
    });
    json(res, 200, { ok: true, branding });
    return true;
  }

  // ── Tenant white-label routing identity (slug + custom domain) ──────────────
  if (req.url === "/tenant/domains" && (req.method === "GET" || req.method === "PUT")) {
    const auth = await authorize(req, res, null);
    if (!auth.ok) return true;
    const { tenantId, permissions } = auth.context;
    if (!(await ensureTenantAccess(tenantId))) {
      json(res, 403, { ok: false, error: "Tenant not found or access denied" });
      return true;
    }
    if (!canAccess(permissions, `${req.method} /tenant/domains`)) {
      json(res, 403, { ok: false, error: "Insufficient permissions" });
      return true;
    }

    if (req.method === "GET") {
      const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true, customDomain: true } });
      json(res, 200, { ok: true, slug: t?.slug ?? null, customDomain: t?.customDomain ?? null });
      return true;
    }

    // PUT — customers self-serve only their *.eynis.com subdomain (slug). The
    // custom CNAME domain is provider-managed (E-10): it needs DNS/SSL set up by
    // us, so it's set via the internal provisioning console, not here. Reject any
    // attempt to self-set a custom domain and point them at the request path.
    const body = (await parseBody(req)) as { slug?: unknown; customDomain?: unknown };
    if ("customDomain" in body) {
      json(res, 403, { ok: false, error: "Custom domains are provisioned by our team — use Request a custom domain to ask for one." });
      return true;
    }
    const data: { slug?: string | null } = {};
    if ("slug" in body) {
      const s = asTrimmedString(body.slug)?.toLowerCase() ?? null;
      if (s !== null && !/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(s)) {
        json(res, 400, { ok: false, error: "slug must be 2–32 chars: lowercase letters, numbers, hyphens" });
        return true;
      }
      data.slug = s;
    }
    try {
      const updated = await prisma.tenant.update({ where: { id: tenantId }, data, select: { slug: true, customDomain: true } });
      json(res, 200, { ok: true, slug: updated.slug, customDomain: updated.customDomain });
    } catch (e) {
      // Unique constraint (P2002) → slug/domain already claimed by another tenant.
      if ((e as { code?: string }).code === "P2002") {
        json(res, 409, { ok: false, error: "That slug or domain is already in use" });
        return true;
      }
      throw e;
    }
    return true;
  }

  // ── Request a custom domain (E-10) — customer-initiated, provider-fulfilled ──
  // Customers can't self-set a CNAME (provider-managed). They ask for one here;
  // the request is written to the audit log so Eynis staff can action it from
  // the provisioning console. Intentionally lightweight — no new model.
  if (req.url === "/tenant/domains/request" && req.method === "POST") {
    const auth = await authorize(req, res, "POST /tenant/domains/request");
    if (!auth.ok) return true;
    const { tenantId } = auth.context;
    if (!(await ensureTenantAccess(tenantId))) {
      json(res, 403, { ok: false, error: "Tenant not found or access denied" });
      return true;
    }
    const body = (await parseBody(req)) as { desiredDomain?: unknown; note?: unknown };
    const desiredDomain = asTrimmedString(body.desiredDomain)?.toLowerCase() ?? null;
    await prisma.auditLog.create({
      data: {
        tenantId,
        actorRole: "tenant_admin",
        action: "tenant.custom_domain_requested",
        entityType: "tenant",
        entityId: tenantId,
        metadata: JSON.stringify({
          desiredDomain,
          note: asTrimmedString(body.note) ?? null,
          requestedBy: auth.context.email ?? null,
        }),
      },
    });
    json(res, 200, { ok: true });
    return true;
  }

  // Real notification feed for the top-bar bell. Aggregates the tenant's live
  // operational signals — SLA-breached / escalated requests, low-stock items,
  // and quotes about to expire — instead of the hard-coded sample list the UI
  // used to show. Each source is gated by the caller's own permission, so a
  // viewer only sees what they may read. Industry-neutral copy; the records
  // themselves are the tenant's, so they read correctly for any vertical.
  if (req.url === "/notifications" && req.method === "GET") {
    const auth = await authorize(req, res, "GET /notifications");
    if (!auth.ok) return true;
    const context = auth.context;
    const perms = context.permissions;
    const now = new Date();
    const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // next 3 days

    type Notif = { id: string; type: "alert" | "info" | "success"; title: string; body: string; at: string; href: string };

    // Gate each source by BOTH the caller's permission AND their own
    // notification preferences (escalations/inventory/quotes toggles in Settings).
    const me = await prisma.user.findUnique({ where: { id: context.userId }, select: { notificationPrefs: true } });
    const prefs = parseNotificationPrefs(me?.notificationPrefs ?? null);
    const canRequests = canAccess(perms, "GET /service-requests") && prefs.escalations;
    const canInventory = canAccess(perms, "GET /inventory/items") && prefs.inventory;
    const canQuotes = canAccess(perms, "GET /quotes") && prefs.quotes;

    const [breached, escalated, inventory, expiring] = await Promise.all([
      canRequests
        ? prisma.serviceRequest.findMany({
            where: { tenantId: context.tenantId, status: { not: "resolved" }, slaBreachedAt: { not: null } },
            orderBy: { slaBreachedAt: "desc" }, take: 6,
            select: { id: true, summary: true, slaBreachedAt: true },
          })
        : Promise.resolve([] as { id: string; summary: string; slaBreachedAt: Date | null }[]),
      canRequests
        ? prisma.serviceRequest.findMany({
            where: { tenantId: context.tenantId, status: "escalated", slaBreachedAt: null },
            orderBy: { createdAt: "desc" }, take: 6,
            select: { id: true, summary: true, createdAt: true },
          })
        : Promise.resolve([] as { id: string; summary: string; createdAt: Date }[]),
      // Prisma can't compare two columns (stock <= reorderLevel) in a where, so
      // pull a bounded set and filter in JS — tenant inventories are small.
      canInventory
        ? prisma.inventoryItem.findMany({
            where: { tenantId: context.tenantId },
            orderBy: { updatedAt: "desc" }, take: 200,
            select: { id: true, name: true, stock: true, unit: true, reorderLevel: true, updatedAt: true },
          })
        : Promise.resolve([] as { id: string; name: string; stock: number; unit: string; reorderLevel: number; updatedAt: Date }[]),
      canQuotes
        ? prisma.quote.findMany({
            where: { tenantId: context.tenantId, status: "sent", validUntil: { not: null, gte: now, lte: soon } },
            orderBy: { validUntil: "asc" }, take: 6,
            select: { id: true, number: true, title: true, validUntil: true },
          })
        : Promise.resolve([] as { id: string; number: string; title: string; validUntil: Date | null }[]),
    ]);

    const items: Notif[] = [];
    for (const s of breached) {
      items.push({ id: `sr-breach-${s.id}`, type: "alert", title: `Overdue: ${s.summary}`, body: "Past its SLA deadline — needs attention", at: (s.slaBreachedAt ?? now).toISOString(), href: "/queue" });
    }
    for (const s of escalated) {
      items.push({ id: `sr-esc-${s.id}`, type: "alert", title: `Escalated: ${s.summary}`, body: "Escalated for follow-up", at: s.createdAt.toISOString(), href: "/queue" });
    }
    for (const it of inventory.filter((i) => i.stock <= i.reorderLevel).slice(0, 6)) {
      items.push({ id: `inv-${it.id}`, type: "alert", title: `${it.name} is low on stock`, body: `${it.stock} ${it.unit} left · reorder level ${it.reorderLevel}`, at: it.updatedAt.toISOString(), href: "/inventory" });
    }
    for (const q of expiring) {
      items.push({ id: `quote-${q.id}`, type: "info", title: `Quote ${q.number} expiring soon`, body: `${q.title} · valid until ${q.validUntil!.toISOString().slice(0, 10)}`, at: q.validUntil!.toISOString(), href: "/quotes" });
    }

    // Alerts first, then by recency. Cap the feed so the dropdown stays tidy.
    const severity = (t: Notif["type"]) => (t === "alert" ? 0 : t === "info" ? 1 : 2);
    items.sort((a, b) => severity(a.type) - severity(b.type) || b.at.localeCompare(a.at));

    json(res, 200, { ok: true, items: items.slice(0, 12) });
    return true;
  }

  return false;
}
