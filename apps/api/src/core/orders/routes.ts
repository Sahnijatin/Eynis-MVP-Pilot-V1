// Orders domain router (Phase 7) — the fulfillment pipeline behind the mfg/F&B
// "Live Orders" board. Returns true when the request was handled; authorization
// goes through the shared authorize()/permissionMap contract (CRM permissions:
// orders are the commercial continuation of quotes/deals).

import type { IncomingMessage, ServerResponse } from "node:http";
import { authorize } from "../authz";
import { json, parseObjectBody, parseUrl, asTrimmedString, asSafeLimit, asSafeOffset, dateOrNull } from "../../http/helpers";
import { listOrders, getOrder, orderSummary, moveOrderStage, isOrderStage, ORDER_STAGES } from "./service";
import { prisma } from "../../db/prisma";

export async function handleOrderRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const routePath = parseUrl(req.url).pathname;
  if (!(routePath === "/orders" || routePath.startsWith("/orders/"))) return false;

  // GET /orders[?stage=&limit=&offset=] — list + stage summary in one call.
  if (routePath === "/orders" && req.method === "GET") {
    const auth = await authorize(req, res, "GET /orders");
    if (!auth.ok) return true;
    const sp = parseUrl(req.url).searchParams;
    const limit = asSafeLimit(sp.get("limit"), 100, 500);
    const offset = asSafeOffset(sp.get("offset"));
    const [{ items, total }, summary] = await Promise.all([
      listOrders(auth.context.tenantId, { stage: sp.get("stage") ?? undefined, limit, offset }),
      orderSummary(auth.context.tenantId),
    ]);
    json(res, 200, { ok: true, items, summary, page: { limit, offset, total, hasMore: offset + items.length < total } });
    return true;
  }

  const idMatch = /^\/orders\/([^/]+)(?:\/(stage))?$/.exec(routePath);
  if (!idMatch) { json(res, 404, { ok: false, error: "Not found" }); return true; }
  const orderId = idMatch[1];
  const sub = idMatch[2];

  // GET /orders/:id — detail + transition history.
  if (!sub && req.method === "GET") {
    const auth = await authorize(req, res, "GET /orders/:id");
    if (!auth.ok) return true;
    const order = await getOrder(auth.context.tenantId, orderId);
    if (!order) { json(res, 404, { ok: false, error: "Order not found" }); return true; }
    json(res, 200, { ok: true, order });
    return true;
  }

  // PATCH /orders/:id — stage move and/or field updates (promisedDate, notes).
  if (!sub && req.method === "PATCH") {
    const auth = await authorize(req, res, "PATCH /orders/:id");
    if (!auth.ok) return true;
    const body = await parseObjectBody(req);
    const existing = await prisma.order.findFirst({ where: { id: orderId, tenantId: auth.context.tenantId }, select: { id: true } });
    if (!existing) { json(res, 404, { ok: false, error: "Order not found" }); return true; }
    const fields: Record<string, unknown> = {};
    if (body.promisedDate !== undefined) fields.promisedDate = dateOrNull(body.promisedDate);
    if (body.notes !== undefined) fields.notes = asTrimmedString(body.notes);
    if (Object.keys(fields).length) await prisma.order.update({ where: { id: orderId }, data: fields });
    if (body.stage !== undefined) {
      if (!isOrderStage(body.stage)) {
        json(res, 400, { ok: false, error: `stage must be one of: ${ORDER_STAGES.join(", ")}` });
        return true;
      }
      const order = await moveOrderStage(auth.context.tenantId, orderId, body.stage, auth.context.userId);
      json(res, 200, { ok: true, order });
      return true;
    }
    json(res, 200, { ok: true, order: await getOrder(auth.context.tenantId, orderId) });
    return true;
  }

  json(res, 404, { ok: false, error: "Not found" });
  return true;
}
