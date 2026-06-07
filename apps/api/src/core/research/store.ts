// DB helpers for Research Studio templates (RS-1). Keeps the server route handlers
// lean: assembling a template definition from its columns, merging built-ins with
// the tenant's saved templates, and loading a definition for a run. All reads are
// tenant-scoped by the caller.

import { prisma } from "../../db/prisma";
import { BUILTIN_TEMPLATES, getBuiltinTemplate, isBuiltinId } from "./templates";
import { validateTemplateDef, type ResearchTemplateDef, type TemplateSources } from "./types";

export interface TemplateView {
  id: string;
  name: string;
  description: string | null;
  subjectType: string;
  isBuiltIn: boolean;
  sectionCount: number;
  sourceCount: number;
  updatedAt: string | null;
  createdById: string | null;
}

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  subjectType: string;
  inputsJson: string;
  sourcesJson: string;
  sectionsJson: string;
  createdById: string | null;
  updatedAt: Date;
}

const safeParse = (json: string): unknown => {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const countEnabledSources = (s: TemplateSources): number =>
  [s.webSearch?.enabled, s.crawl?.enabled, s.pagespeed?.enabled].filter(Boolean).length;

// Reassemble a stored row into a validated definition (rows are validated on write,
// but we re-validate defensively so a hand-edited DB row can't drive the engine).
export function rowToDef(row: TemplateRow): ResearchTemplateDef {
  const v = validateTemplateDef({
    name: row.name,
    description: row.description ?? undefined,
    subjectType: row.subjectType,
    inputs: safeParse(row.inputsJson),
    sources: safeParse(row.sourcesJson),
    sections: safeParse(row.sectionsJson),
  });
  if (v.ok) return v.def;
  return { name: row.name, description: row.description ?? undefined, subjectType: "freeform", inputs: [], sources: {}, sections: [] };
}

export async function listTemplates(tenantId: string): Promise<TemplateView[]> {
  const rows = (await prisma.researchTemplate.findMany({
    where: { tenantId },
    orderBy: { updatedAt: "desc" },
  })) as TemplateRow[];

  const builtinViews: TemplateView[] = BUILTIN_TEMPLATES.map((b) => ({
    id: b.id,
    name: b.def.name,
    description: b.def.description ?? null,
    subjectType: b.def.subjectType,
    isBuiltIn: true,
    sectionCount: b.def.sections.length,
    sourceCount: countEnabledSources(b.def.sources),
    updatedAt: null,
    createdById: null,
  }));

  const dbViews: TemplateView[] = rows.map((r) => {
    const def = rowToDef(r);
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      subjectType: r.subjectType,
      isBuiltIn: false,
      sectionCount: def.sections.length,
      sourceCount: countEnabledSources(def.sources),
      updatedAt: r.updatedAt.toISOString(),
      createdById: r.createdById,
    };
  });

  return [...builtinViews, ...dbViews];
}

// Full definition + meta for the editor / detail view.
export async function getTemplateDetail(
  tenantId: string,
  id: string,
): Promise<{ id: string; isBuiltIn: boolean; createdById: string | null; def: ResearchTemplateDef } | null> {
  if (isBuiltinId(id)) {
    const b = getBuiltinTemplate(id);
    return b ? { id: b.id, isBuiltIn: true, createdById: null, def: b.def } : null;
  }
  const row = (await prisma.researchTemplate.findFirst({ where: { id, tenantId } })) as TemplateRow | null;
  return row ? { id: row.id, isBuiltIn: false, createdById: row.createdById, def: rowToDef(row) } : null;
}

// Definition to run (built-in or saved). Returns null if not found in this tenant.
export async function loadTemplateForRun(
  tenantId: string,
  id: string,
): Promise<{ def: ResearchTemplateDef; name: string } | null> {
  const detail = await getTemplateDetail(tenantId, id);
  return detail ? { def: detail.def, name: detail.def.name } : null;
}
