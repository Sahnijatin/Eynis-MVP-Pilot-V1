// Inventory domain router (5.1) — extracted verbatim from server.ts. Returns
// true when the request was handled (response written); false lets the main
// dispatcher continue. Authorization goes through the shared authorize()/
// permissionMap contract like every other route.
import type { IncomingMessage, ServerResponse } from "node:http";
import { authorize } from "../authz";
import { json, parseBody, asTrimmedString, parseUrl } from "../../http/helpers";
import { listInventory, applyMovement, updateItem, deleteItem, listMovements, yieldSummary, toPaise, type MovementType } from "./service";

export async function handleInventoryRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const routePath = parseUrl(req.url).pathname;
  if (!(routePath === "/inventory" || routePath.startsWith("/inventory/"))) return false;

    // ── Inventory (vertical with real persistence) ───────────────────────────
    if (req.url === "/inventory/items" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /inventory/items");
      if (!auth.ok) return true;
      const items = await listInventory(auth.context.tenantId);
      json(res, 200, { ok: true, items });
      return true;
    }

    if (req.url === "/inventory/items" && req.method === "POST") {
      const auth = await authorize(req, res, "POST /inventory/items");
      if (!auth.ok) return true;
      const body = (await parseBody(req)) as Record<string, unknown>;
      const name = asTrimmedString(body.name);
      if (!name) { json(res, 400, { ok: false, error: "name is required" }); return true; }
      const txType = (["received", "used", "waste"].includes(String(body.txType)) ? body.txType : "received") as MovementType;
      const qty = Number(body.qty);
      if (!Number.isFinite(qty) || qty < 0) { json(res, 400, { ok: false, error: "qty must be a non-negative number" }); return true; }
      try {
        const item = await applyMovement(auth.context.tenantId, {
          name, txType, qty,
          category: asTrimmedString(body.category) ?? undefined,
          unit: asTrimmedString(body.unit) ?? undefined,
          reorderLevel: body.reorderLevel != null ? Number(body.reorderLevel) : undefined,
          unitCostPaise: toPaise({ unitCostPaise: body.unitCostPaise as number | undefined, unitCostInr: body.unitCostInr as number | undefined }),
          ref: asTrimmedString(body.ref),
          note: asTrimmedString(body.note),
          actorId: auth.context.userId,
        });
        json(res, 200, { ok: true, item });
      } catch (e) {
        json(res, 400, { ok: false, error: e instanceof Error ? e.message : "Invalid request" });
      }
      return true;
    }

    // GET /inventory/movements[?itemId=&limit=] — the immutable stock ledger (4.2).
    if (req.url?.startsWith("/inventory/movements") && req.method === "GET") {
      const auth = await authorize(req, res, "GET /inventory/movements");
      if (!auth.ok) return true;
      const sp = parseUrl(req.url).searchParams;
      const items = await listMovements(auth.context.tenantId, {
        itemId: sp.get("itemId") ?? undefined,
        limit: sp.get("limit") ? Number(sp.get("limit")) : undefined,
      });
      json(res, 200, { ok: true, items });
      return true;
    }

    // GET /inventory/yield[?days=90] — per-material consumption/waste + accepted-quote demand (4.3).
    if (req.url?.startsWith("/inventory/yield") && req.method === "GET") {
      const auth = await authorize(req, res, "GET /inventory/yield");
      if (!auth.ok) return true;
      const daysRaw = Number(parseUrl(req.url).searchParams.get("days"));
      const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(daysRaw, 365) : 90;
      const items = await yieldSummary(auth.context.tenantId, days);
      json(res, 200, { ok: true, windowDays: days, items });
      return true;
    }

    const invItemMatch = /^\/inventory\/items\/([^/]+)$/.exec(req.url ?? "");
    if (invItemMatch && req.method === "PUT") {
      const auth = await authorize(req, res, "PUT /inventory/items/:id");
      if (!auth.ok) return true;
      const body = (await parseBody(req)) as Record<string, unknown>;
      const fields: Partial<{ name: string; category: string; stock: number; unit: string; reorderLevel: number; unitCostPaise: number }> = {};
      const nm = asTrimmedString(body.name); if (nm) fields.name = nm;
      const cat = asTrimmedString(body.category); if (cat) fields.category = cat;
      const un = asTrimmedString(body.unit); if (un) fields.unit = un;
      if (body.stock != null && Number.isFinite(Number(body.stock))) fields.stock = Math.max(0, Number(body.stock));
      if (body.reorderLevel != null && Number.isFinite(Number(body.reorderLevel))) fields.reorderLevel = Math.max(0, Number(body.reorderLevel));
      const paise = toPaise({ unitCostPaise: body.unitCostPaise as number | undefined, unitCostInr: body.unitCostInr as number | undefined });
      if (paise != null) fields.unitCostPaise = paise;
      const item = await updateItem(auth.context.tenantId, invItemMatch[1], fields, auth.context.userId);
      if (!item) { json(res, 404, { ok: false, error: "Item not found" }); return true; }
      json(res, 200, { ok: true, item });
      return true;
    }
    if (invItemMatch && req.method === "DELETE") {
      const auth = await authorize(req, res, "DELETE /inventory/items/:id");
      if (!auth.ok) return true;
      const removed = await deleteItem(auth.context.tenantId, invItemMatch[1]);
      if (!removed) { json(res, 404, { ok: false, error: "Item not found" }); return true; }
      json(res, 200, { ok: true });
      return true;
    }

    
  return false;
}
