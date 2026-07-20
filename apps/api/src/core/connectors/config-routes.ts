// Connector configuration router (#164) — the per-tenant Integrations surface:
// the registry overlay (catalog + this tenant's enabled/config/status), the config
// list, a live-key test, and the PUT/DELETE that persist a tenant's connector
// config. Extracted verbatim from server.ts; returns true when it handled the
// request, false to let the dispatcher continue. Every route is tenant-authorized
// via `authorize` — secrets are masked on read and preserved on re-save.
import type { IncomingMessage, ServerResponse } from "node:http";
import { CONNECTOR_CATALOG, CONNECTOR_CATEGORY_LABELS, connectorEnvFlag } from "@eynis/shared";
import { prisma } from "../../db/prisma";
import { authorize } from "../authz";
import { json, parseBody, parseUrl } from "../../http/helpers";

// Connector registry. The static catalog (name, description, what it needs,
// icon/brand, planned flag) is shared with the web Integrations module via
// @eynis/shared; here we add the runtime env flag. The GET handler overlays
// per-tenant status and config.
const connectorRegistry = CONNECTOR_CATALOG.map((c) => ({ ...c, envFlag: connectorEnvFlag(c.key) }));

const envFlagByConnectorKey = new Map<string, string>(
  connectorRegistry.map((item) => [item.key, item.envFlag])
);

// Detects secret-like field keys (so they're masked in responses and preserved on
// re-save when the client echoes the mask instead of a real value).
const isSecretKey = (key: string): boolean => {
  const k = key.toLowerCase();
  return k.includes("secret") || k.includes("token") || k.includes("password") || k.endsWith("key");
};
const SECRET_MASK = "***";

const maskConnectorConfig = (config: Record<string, unknown>) => {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    masked[key] = isSecretKey(key) && typeof value === "string" && value.length > 0 ? SECRET_MASK : value;
  }
  return masked;
};

const parseConnectorConfigPath = (url: string | undefined): string | null => {
  if (!url) {
    return null;
  }
  const parsed = parseUrl(url);
  const match = /^\/connectors\/configs\/([^/]+)$/.exec(parsed.pathname);
  if (!match || !match[1]) {
    return null;
  }
  return decodeURIComponent(match[1]);
};

export async function handleConnectorConfigRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.url === "/connectors/registry" && req.method === "GET") {
    const auth = await authorize(req, res, "GET /connectors/registry");
    if (!auth.ok) return true;
    const context = auth.context;

    const configs = await prisma.connectorConfig.findMany({
      where: { tenantId: context.tenantId },
      select: { connectorKey: true, enabled: true, configJson: true }
    });
    const configMap = new Map(configs.map((c) => [c.connectorKey, c]));
    const items = connectorRegistry.map((item) => {
      const persisted = configMap.get(item.key);
      const envEnabled = String(process.env[item.envFlag] ?? "").toLowerCase() === "true";
      const enabled = persisted ? persisted.enabled : envEnabled;
      let savedConfig: Record<string, unknown> = {};
      if (persisted) {
        try { const m = JSON.parse(persisted.configJson) as Record<string, unknown>; if (m && typeof m === "object") savedConfig = m; } catch { /* ignore */ }
      }
      const status = item.planned ? "planned" : enabled ? "connected" : "disabled";
      return {
        key: item.key,
        category: item.category,
        categoryLabel: CONNECTOR_CATEGORY_LABELS[item.category] ?? item.category,
        name: item.name,
        description: item.description,
        icon: item.icon,
        brandColor: item.brandColor,
        requiredFields: item.requiredFields,
        planned: item.planned,
        enabled,
        status,
        source: persisted ? ("hotel_config" as const) : ("env" as const),
        ingestModes: item.ingestModes,
        config: maskConnectorConfig(savedConfig)
      };
    });
    json(res, 200, { ok: true, items });
    return true;
  }

  if (req.url?.startsWith("/connectors/configs") && req.method === "GET") {
    const auth = await authorize(req, res, "GET /connectors/configs");
    if (!auth.ok) return true;
    const context = auth.context;

    const items = await prisma.connectorConfig.findMany({
      where: { tenantId: context.tenantId },
      orderBy: { connectorKey: "asc" },
      select: { connectorKey: true, enabled: true, configJson: true, updatedAt: true }
    });
    json(res, 200, {
      ok: true,
      items: items.map((item) => {
        let parsed: Record<string, unknown> = {};
        try {
          const maybe = JSON.parse(item.configJson) as Record<string, unknown>;
          parsed = maybe && typeof maybe === "object" ? maybe : {};
        } catch {
          parsed = {};
        }
        return {
          key: item.connectorKey,
          enabled: item.enabled,
          config: maskConnectorConfig(parsed),
          updatedAt: item.updatedAt
        };
      })
    });
    return true;
  }

  // POST /connectors/configs/:key/test — live-key validation (Phase 8): cheap
  // authenticated ping so a bad credential is caught before a campaign launch.
  const connectorTestMatch = /^\/connectors\/configs\/([^/]+)\/test$/.exec(parseUrl(req.url).pathname);
  if (connectorTestMatch && req.method === "POST") {
    const auth = await authorize(req, res, "POST /connectors/configs/:key/test");
    if (!auth.ok) return true;
    const key = decodeURIComponent(connectorTestMatch[1] as string);
    if (!envFlagByConnectorKey.has(key)) { json(res, 404, { ok: false, error: "Unknown connector key" }); return true; }
    const { testConnector } = await import("./test-connection");
    const result = await testConnector(auth.context.tenantId, key);
    if (!result) { json(res, 200, { ok: true, testable: false, detail: "This connector has no live test (file export / on-prem integration)" }); return true; }
    json(res, 200, { ok: true, testable: true, passed: result.ok, detail: result.detail });
    return true;
  }

  const connectorConfigKey = parseConnectorConfigPath(req.url);
  if (connectorConfigKey && req.method === "PUT") {
    const auth = await authorize(req, res, "PUT /connectors/configs/:key");
    if (!auth.ok) return true;
    const context = auth.context;
    if (!envFlagByConnectorKey.has(connectorConfigKey)) {
      json(res, 404, { ok: false, error: "Unknown connector key" });
      return true;
    }

    const body = (await parseBody(req)) as { enabled?: unknown; config?: unknown };
    const enabled = typeof body.enabled === "boolean" ? body.enabled : false;
    const incoming = body.config && typeof body.config === "object" ? (body.config as Record<string, unknown>) : {};

    // Merge over the existing config so a re-save doesn't clobber secrets the
    // client never saw: GET masks secret fields as "***", so an unchanged secret
    // comes back empty or as the mask — in that case keep the stored value.
    const existingRow = await prisma.connectorConfig.findUnique({
      where: { tenantId_connectorKey: { tenantId: context.tenantId, connectorKey: connectorConfigKey } },
      select: { configJson: true }
    });
    let existing: Record<string, unknown> = {};
    if (existingRow) {
      try { const m = JSON.parse(existingRow.configJson) as Record<string, unknown>; if (m && typeof m === "object") existing = m; } catch { /* ignore */ }
    }
    const merged: Record<string, unknown> = { ...existing };
    for (const [k, v] of Object.entries(incoming)) {
      if (isSecretKey(k) && (v === "" || v === SECRET_MASK || v == null)) continue; // keep stored secret
      merged[k] = v;
    }
    // Encrypt secret field values at rest (F-… H6). No-op when SECRETS_ENC_KEY is
    // unset (values stay plaintext, unchanged behaviour) and idempotent for values
    // already encrypted (the kept-from-existing case).
    const { encryptSecret } = await import("../crypto/secrets");
    for (const k of Object.keys(merged)) {
      if (isSecretKey(k) && typeof merged[k] === "string" && merged[k]) merged[k] = encryptSecret(merged[k] as string);
    }
    const configJson = JSON.stringify(merged);
    const saved = await prisma.connectorConfig.upsert({
      where: { tenantId_connectorKey: { tenantId: context.tenantId, connectorKey: connectorConfigKey } },
      create: {
        tenantId: context.tenantId,
        connectorKey: connectorConfigKey,
        enabled,
        configJson
      },
      update: {
        enabled,
        configJson
      },
      select: { connectorKey: true, enabled: true, configJson: true, updatedAt: true }
    });

    await prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorRole: context.role,
        action: "connector.config.updated",
        entityType: "connector_config",
        entityId: saved.connectorKey,
        metadata: JSON.stringify({ connectorKey: saved.connectorKey, enabled: saved.enabled })
      }
    });

    let parsed: Record<string, unknown> = {};
    try {
      const maybe = JSON.parse(saved.configJson) as Record<string, unknown>;
      parsed = maybe && typeof maybe === "object" ? maybe : {};
    } catch {
      parsed = {};
    }

    json(res, 200, {
      ok: true,
      item: {
        key: saved.connectorKey,
        enabled: saved.enabled,
        config: maskConnectorConfig(parsed),
        updatedAt: saved.updatedAt
      }
    });
    return true;
  }

  if (connectorConfigKey && req.method === "DELETE") {
    const auth = await authorize(req, res, "DELETE /connectors/configs/:key");
    if (!auth.ok) return true;
    const context = auth.context;

    await prisma.connectorConfig.deleteMany({
      where: { tenantId: context.tenantId, connectorKey: connectorConfigKey }
    });
    await prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorRole: context.role,
        action: "connector.config.deleted",
        entityType: "connector_config",
        entityId: connectorConfigKey,
        metadata: JSON.stringify({ connectorKey: connectorConfigKey })
      }
    });
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
