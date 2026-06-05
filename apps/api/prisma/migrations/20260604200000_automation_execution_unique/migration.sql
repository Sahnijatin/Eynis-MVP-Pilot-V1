-- F-13: enforce one AutomationExecution per (ruleId, triggerEntityId) so the
-- idempotency check (hasExecution) is backed by a DB constraint, not just an
-- in-app check-then-act. Deduplicate any rows left by the pre-fix race first
-- (keep the earliest; id breaks ties on equal timestamps), then swap the plain
-- index for a unique one. NULL triggerEntityId rows are exempt (Postgres treats
-- NULLs as distinct), which is correct — those are non-entity executions.

DELETE FROM "AutomationExecution" a
USING "AutomationExecution" b
WHERE a."ruleId" = b."ruleId"
  AND a."triggerEntityId" = b."triggerEntityId"
  AND a."triggerEntityId" IS NOT NULL
  AND (a."executedAt" > b."executedAt" OR (a."executedAt" = b."executedAt" AND a."id" > b."id"));

DROP INDEX IF EXISTS "AutomationExecution_ruleId_triggerEntityId_idx";

CREATE UNIQUE INDEX "AutomationExecution_ruleId_triggerEntityId_key"
  ON "AutomationExecution"("ruleId", "triggerEntityId");
