// Automation provisioning (#160) — give a newly created tenant the operational
// automation rules its industry pack declares.
//
// Before this, only the demo hotel (prisma/seed.ts) had automation rules; tenants
// created through the runtime workspace-create flow got none, so the engine had
// nothing to evaluate for them. The active rule set is now pack-driven: hospitality
// gets all four operational rules, a generic vertical gets the two universal ones
// (SLA escalation + sentiment flag). Standing up a new vertical changes only the
// pack's `automations` list — no engine change.
//
// Idempotent and non-destructive: an existing rule (a tenant's own edit — e.g. one
// they toggled off) is never clobbered, thanks to the unique (tenantId, code) index.

import { prisma } from "../../db/prisma";
import { getIndustryPack, OPERATIONAL_RULE_DEFS, type AutomationRuleDef } from "../industry-pack";

/**
 * Seed the industry pack's operational automation rules for a tenant. Returns the
 * number of rules newly created. A single createMany with skipDuplicates makes this
 * atomic and race-safe (concurrent calls can't collide on the (tenantId, code)
 * unique index) and non-destructive (an existing rule — e.g. one the tenant toggled
 * off — is skipped, never clobbered).
 */
export async function seedAutomationRulesForTenant(
  tenantId: string,
  industry: string | null | undefined,
): Promise<number> {
  const pack = getIndustryPack(industry);
  const data = pack.automations
    .map((code) => OPERATIONAL_RULE_DEFS[code])
    .filter((def): def is AutomationRuleDef => Boolean(def)) // skip codes with no definition
    .map((def) => ({ tenantId, code: def.code, name: def.name, isActive: true, configJson: def.configJson }));

  if (data.length === 0) return 0;
  const result = await prisma.automationRule.createMany({ data, skipDuplicates: true });
  return result.count;
}
