// Menu domain router (Wave 5) — F&B menu catalogue with real persistence.
// Returns true when the request was handled. Auth goes through the shared
// authorize()/permissionMap contract like every other route.
import type { IncomingMessage, ServerResponse } from "node:http";
import { authorize } from "../authz";
import { prisma } from "../../db/prisma";
import { json, parseObjectBody, asTrimmedString, parseUrl } from "../../http/helpers";

type MenuRow = {
  id: string; name: string; category: string; description: string | null;
  isAvailable: boolean; pricePaise: number; costPaise: number;
};

// Money in paise everywhere; margin derived for the UI.
const serialize = (m: MenuRow) => {
  const marginPct = m.pricePaise > 0 ? Math.round(((m.pricePaise - m.costPaise) / m.pricePaise) * 100) : 0;
  return {
    id: m.id, name: m.name, category: m.category, description: m.description,
    isAvailable: m.isAvailable,
    pricePaise: m.pricePaise, priceInr: m.pricePaise / 100,
    costPaise: m.costPaise, costInr: m.costPaise / 100,
    marginPct,
  };
};

const SELECT = { id: true, name: true, category: true, description: true, isAvailable: true, pricePaise: true, costPaise: true };

// Accept price/cost either in paise (pricePaise) or whole rupees (priceInr).
const toPaise = (paise: unknown, inr: unknown): number | undefined => {
  if (paise != null && Number.isFinite(Number(paise))) return Math.max(0, Math.round(Number(paise)));
  if (inr != null && Number.isFinite(Number(inr))) return Math.max(0, Math.round(Number(inr) * 100));
  return undefined;
};

export async function handleMenuRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const routePath = parseUrl(req.url).pathname;
  if (!(routePath === "/menu" || routePath.startsWith("/menu/"))) return false;

  // GET /menu/items — the tenant's menu, newest first.
  if (req.url === "/menu/items" && req.method === "GET") {
    const auth = await authorize(req, res, "GET /menu/items");
    if (!auth.ok) return true;
    const items = await prisma.menuItem.findMany({
      where: { tenantId: auth.context.tenantId },
      orderBy: [{ category: "asc" }, { name: "asc" }],
      select: SELECT,
    });
    json(res, 200, { ok: true, items: items.map(serialize) });
    return true;
  }

  // POST /menu/items — create an item.
  if (req.url === "/menu/items" && req.method === "POST") {
    const auth = await authorize(req, res, "POST /menu/items");
    if (!auth.ok) return true;
    const body = await parseObjectBody(req);
    const name = asTrimmedString(body.name);
    if (!name) { json(res, 400, { ok: false, error: "name is required" }); return true; }
    try {
      const item = await prisma.menuItem.create({
        data: {
          tenantId: auth.context.tenantId,
          name,
          category: asTrimmedString(body.category) ?? "Other",
          description: asTrimmedString(body.description),
          pricePaise: toPaise(body.pricePaise, body.priceInr) ?? 0,
          costPaise: toPaise(body.costPaise, body.costInr) ?? 0,
          isAvailable: body.isAvailable === undefined ? true : body.isAvailable === true,
        },
        select: SELECT,
      });
      json(res, 200, { ok: true, item: serialize(item) });
    } catch (e) {
      // Unique (tenantId, name) collision → friendly message.
      const msg = e instanceof Error && e.message.includes("Unique") ? "An item with that name already exists" : "Invalid request";
      json(res, 400, { ok: false, error: msg });
    }
    return true;
  }

  const itemMatch = /^\/menu\/items\/([^/]+)$/.exec(routePath);

  // PATCH /menu/items/:id — update fields (only those provided).
  if (itemMatch && req.method === "PATCH") {
    const auth = await authorize(req, res, "PATCH /menu/items/:id");
    if (!auth.ok) return true;
    const id = decodeURIComponent(itemMatch[1] as string);
    const existing = await prisma.menuItem.findFirst({ where: { id, tenantId: auth.context.tenantId }, select: { id: true } });
    if (!existing) { json(res, 404, { ok: false, error: "Menu item not found" }); return true; }
    const body = await parseObjectBody(req);
    const data: Record<string, unknown> = {};
    const nm = asTrimmedString(body.name); if (body.name !== undefined) { if (!nm) { json(res, 400, { ok: false, error: "name cannot be empty" }); return true; } data.name = nm; }
    if (body.category !== undefined) data.category = asTrimmedString(body.category) ?? "Other";
    if (body.description !== undefined) data.description = asTrimmedString(body.description);
    const p = toPaise(body.pricePaise, body.priceInr); if (p !== undefined) data.pricePaise = p;
    const c = toPaise(body.costPaise, body.costInr); if (c !== undefined) data.costPaise = c;
    if (body.isAvailable !== undefined) data.isAvailable = body.isAvailable === true;
    try {
      const item = await prisma.menuItem.update({ where: { id }, data, select: SELECT });
      json(res, 200, { ok: true, item: serialize(item) });
    } catch (e) {
      const msg = e instanceof Error && e.message.includes("Unique") ? "An item with that name already exists" : "Invalid request";
      json(res, 400, { ok: false, error: msg });
    }
    return true;
  }

  // DELETE /menu/items/:id
  if (itemMatch && req.method === "DELETE") {
    const auth = await authorize(req, res, "DELETE /menu/items/:id");
    if (!auth.ok) return true;
    const id = decodeURIComponent(itemMatch[1] as string);
    const existing = await prisma.menuItem.findFirst({ where: { id, tenantId: auth.context.tenantId }, select: { id: true } });
    if (!existing) { json(res, 404, { ok: false, error: "Menu item not found" }); return true; }
    await prisma.menuItem.delete({ where: { id } });
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
