// Research run orchestration (RS-1): gather → synthesize → finalize. Drives one
// ResearchRun row through its lifecycle, writing status/progress at each stage and
// broadcasting SSE so the UI can show live progress. On completion it best-effort
// logs the result to the CRM timeline when the run targets a contact/deal/company
// (the bridge to the contextual surface, RS-2). Tenant-scoped throughout.

import { prisma } from "../../db/prisma";
import { broadcastSSEEvent } from "../../sse/clients";
import { validateTemplateDef, type ResearchTemplateDef } from "./types";
import { gather } from "./gather";
import { synthesize } from "./synthesize";
import { resolveAiCredentials } from "./ai-credentials";
import { suggestFromResearchScore } from "../crm/suggestions";

type Stage = "gathering" | "synthesizing" | "validating" | "ready" | "failed";

async function setStage(
  runId: string,
  tenantId: string,
  stage: Stage,
  progress: number,
  extra: Record<string, unknown> = {},
): Promise<void> {
  await prisma.researchRun.update({
    where: { id: runId },
    data: { status: stage, progress, stage: STAGE_LABEL[stage], ...extra },
  });
  broadcastSSEEvent(tenantId, { type: "research_run", data: { id: runId, status: stage, progress, stage: STAGE_LABEL[stage] } });
}

const STAGE_LABEL: Record<Stage, string> = {
  gathering: "Gathering sources",
  synthesizing: "Synthesizing report",
  validating: "Validating",
  ready: "Ready",
  failed: "Failed",
};

function parseInputs(json: string): Record<string, string> {
  try {
    const o = JSON.parse(json) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o ?? {})) if (v != null) out[k] = String(v);
    return out;
  } catch {
    return {};
  }
}

// Process a single run by id. Safe to call from the worker; it sets failed + error
// on any unexpected throw so a run never gets stuck mid-flight. Callers holding a
// tenant context (e.g. a "run now" route) must pass expectedTenantId so a stray
// run id can never process another tenant's run; the worker's ids come from its
// own DB scan and may omit it.
export async function processRun(runId: string, expectedTenantId?: string): Promise<void> {
  const run = await prisma.researchRun.findFirst({
    where: { id: runId, ...(expectedTenantId ? { tenantId: expectedTenantId } : {}) },
  });
  if (!run) return;
  const tenantId = run.tenantId;

  const validated = validateTemplateDef(safeParse(run.templateSnapshot));
  if (!validated.ok) {
    await setStage(runId, tenantId, "failed", 0, { error: validated.error, completedAt: new Date() });
    return;
  }
  const def: ResearchTemplateDef = validated.def;

  const startedMs = Date.now();
  try {
    const inputs = parseInputs(run.inputsJson);
    const vars: Record<string, string> = { ...inputs };
    if (!vars.name && run.subjectLabel) vars.name = run.subjectLabel;
    const subject = vars.name || run.subjectLabel || def.name;

    const credentials = await resolveAiCredentials(tenantId);

    await setStage(runId, tenantId, "gathering", 20, { startedAt: new Date() });
    // The agent may run several autonomous search rounds; surface progress as the
    // current stage label (lightweight — no status/progress churn).
    const onProgress = (msg: string) => {
      broadcastSSEEvent(tenantId, { type: "research_run", data: { id: runId, status: "gathering", progress: 30, stage: msg } });
      void prisma.researchRun.update({ where: { id: runId }, data: { stage: msg } }).catch(() => undefined);
    };
    const gathered = await gather(tenantId, def, vars, { credentials, onProgress });

    await setStage(runId, tenantId, "synthesizing", 55, {
      gatheredJson: JSON.stringify({ fetchedCount: gathered.fetchedCount, rounds: gathered.rounds, sources: gathered.sources.map((s) => ({ kind: s.kind, title: s.title, url: s.url })) }),
    });
    const result = await synthesize(def, subject, gathered, { credentials, inputs: vars });

    await setStage(runId, tenantId, "validating", 90);

    const usage = {
      ...result.usage,
      cacheHits: gathered.cacheHits,
      fetchedCount: gathered.fetchedCount,
      rounds: gathered.rounds,
      durationMs: Date.now() - startedMs,
    };
    await setStage(runId, tenantId, "ready", 100, {
      resultJson: JSON.stringify(result),
      score: result.score,
      usageJson: JSON.stringify(usage),
      completedAt: new Date(),
    });

    await logToCrm(run, subject, result.score).catch(() => undefined);
  } catch (err) {
    await setStage(runId, tenantId, "failed", 0, {
      error: err instanceof Error ? err.message.slice(0, 500) : "Research run failed",
      completedAt: new Date(),
    }).catch(() => undefined);
  }
}

// Best-effort CRM write-back: drop an activity on the subject's timeline so the
// research shows up natively where the user works (RS-2/RS-3 build on this).
async function logToCrm(
  run: { id: string; tenantId: string; subjectType: string; subjectId: string | null; templateName: string; createdById: string | null },
  subject: string,
  score: number | null,
): Promise<void> {
  if (!run.subjectId) return;
  const link: { contactId?: string; dealId?: string; companyId?: string } = {};
  if (run.subjectType === "contact") link.contactId = run.subjectId;
  else if (run.subjectType === "deal") link.dealId = run.subjectId;
  else if (run.subjectType === "company") link.companyId = run.subjectId;
  else return;

  await prisma.activity.create({
    data: {
      tenantId: run.tenantId,
      ...link,
      userId: run.createdById ?? undefined,
      type: "system",
      title: `Research complete: ${run.templateName}`,
      body: score != null ? `${subject} — overall score ${score}/100.` : `Research report ready for ${subject}.`,
      meta: { researchRunId: run.id, score },
    },
  });

  // Score write-back (RS-3): a contact's research score updates its lead score so
  // research enriches the CRM signal, not just the timeline. Best-effort, and
  // tenant-scoped via updateMany (defence-in-depth: a no-op if the id isn't this
  // tenant's, even though subjectId ownership is verified at run creation).
  if (run.subjectType === "contact" && score != null) {
    await prisma.contact.updateMany({ where: { id: run.subjectId, tenantId: run.tenantId }, data: { leadScore: score } }).catch(() => undefined);
  }

  // Deal write-back (RS-3): a deal run's research score feeds a SAFE-MODE
  // DealSuggestion — an advance-stage proposal a human confirms — so research
  // nudges the pipeline without ever auto-moving a deal.
  if (run.subjectType === "deal" && score != null) {
    await suggestFromResearchScore(run.tenantId, run.subjectId, score).catch(() => undefined);
  }
}

function safeParse(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
