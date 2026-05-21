import type { ServerResponse } from "node:http";

const clients = new Map<string, ServerResponse>();
let counter = 0;

export function registerSSEClient(res: ServerResponse): string {
  const id = String(++counter);
  clients.set(id, res);
  return id;
}

export function removeSSEClient(id: string): void {
  clients.delete(id);
}

export function broadcastSSEEvent(payload: object): void {
  const line = `data: ${JSON.stringify(payload)}\n\n`;
  for (const [id, res] of clients) {
    try {
      res.write(line);
    } catch {
      clients.delete(id);
    }
  }
}

export function sseClientCount(): number {
  return clients.size;
}
