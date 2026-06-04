import type { RequestContext } from "../core/request-context";

export interface AuditEntry {
  action: string;
  entityType: string;
  entityId?: string;
  metadata: Record<string, string | number | boolean | null>;
  createdAt: string;
}

export class InMemoryAuditLog {
  private readonly entries: Record<string, AuditEntry[]> = {};

  append(context: RequestContext, entry: Omit<AuditEntry, "createdAt">) {
    const next: AuditEntry = {
      ...entry,
      createdAt: new Date().toISOString()
    };
    const current = this.entries[context.tenantId] ?? [];
    current.unshift(next);
    this.entries[context.tenantId] = current.slice(0, 50);
  }

  list(tenantId: string) {
    return this.entries[tenantId] ?? [];
  }
}
