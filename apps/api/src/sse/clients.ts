import type { ServerResponse } from "node:http";

// Each connected client is bound to the tenant it authenticated as, so live-feed
// events are only ever delivered to clients of the originating tenant. Without
// this scoping, broadcastSSEEvent would leak one tenant's service-request updates,
// guest names, and room numbers to every other tenant's open stream (F-1).
type SSEClient = { res: ServerResponse; tenantId: string };

const clients = new Map<string, SSEClient>();
let counter = 0;

export function registerSSEClient(res: ServerResponse, tenantId: string): string {
  const id = String(++counter);
  clients.set(id, { res, tenantId });
  return id;
}

export function removeSSEClient(id: string): void {
  clients.delete(id);
}

/**
 * Deliver an event only to clients belonging to `tenantId`. Every call site must
 * pass the tenant that owns the event — broadcasts are never global.
 */
export function broadcastSSEEvent(tenantId: string, payload: object): void {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const [id, client] of clients) {
    if (client.tenantId !== tenantId) continue;
    try {
      client.res.write(line);
    } catch {
      clients.delete(id);
    }
  }
}

export function sseClientCount(): number {
  return clients.size;
}
