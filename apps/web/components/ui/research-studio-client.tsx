"use client";

// Research Studio (RS-1) — the in-platform UI for the configurable research module.
// One engine, surfaced here as: a templates gallery, a 3-step template editor, a
// run flow with live progress, and a branded report preview with export. Built on
// the ds/ primitives so it looks native and is themed by the tenant's brand accent.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Telescope, Plus, Play, Pencil, Copy, Trash2, ArrowLeft, FileDown, ExternalLink,
  CheckCircle2, AlertTriangle, Search, Globe, Gauge, Sparkles, X, Zap, RotateCw,
} from "lucide-react";
import {
  Button, Card, Badge, Field, Input, Select, Textarea, Modal, Spinner, EmptyState, useToast, tokens as t,
} from "../ds";
import type { ResearchTemplateItem, ResearchRunItem, ResearchSourceCatalog, ResearchTrigger, PipelineRow } from "../../lib/data";
import { splitSectionContent, usageSummary } from "../../lib/research-format";

// ── Local types (mirror the API shapes) ──────────────────────────────────────
interface TemplateInput { key: string; label: string; prefillFrom?: string; required?: boolean }
interface TemplateSources {
  webSearch?: { enabled: boolean; queries?: string[] };
  crawl?: { enabled: boolean; seeds?: string[]; maxPages?: number };
  pagespeed?: { enabled: boolean };
}
type SectionOutput = "text" | "table" | "score";
interface TemplateSection { id?: string; title: string; prompt: string; outputs: SectionOutput[]; weight?: number }
interface TemplateDef {
  name: string; description?: string; subjectType: string;
  inputs: TemplateInput[]; sources: TemplateSources; sections: TemplateSection[];
}
interface TemplateDetail extends TemplateDef { id: string; isBuiltIn: boolean; isOwner: boolean }
interface SynthTable { headers: string[]; rows: string[][] }
interface SynthSection { id: string; title: string; content: string; table: SynthTable | null; score: number | null }
interface RunDetail {
  id: string; templateName: string; subjectType: string; subjectLabel: string | null;
  status: string; progress: number; stage: string | null; score: number | null; error: string | null;
  result: { sections: SynthSection[]; score: number | null; sources?: Array<{ n: number; title: string; url: string }> } | null;
  gathered: { fetchedCount?: number; sources?: Array<{ kind: string; title: string; url?: string }> } | null;
  usage: { provider?: string; llmCalls?: number; usedAI?: boolean; sourcesFetched?: number; cacheHits?: number; durationMs?: number; rounds?: number } | null;
}

interface Props {
  accent: string;
  initialTemplates: ResearchTemplateItem[];
  initialRuns: ResearchRunItem[];
  catalog: ResearchSourceCatalog | null;
  licenseError: string | null;
  initialRunId?: string | null;
  initialTriggers?: ResearchTrigger[];
  pipelines?: PipelineRow[];
}

type View = { mode: "home" } | { mode: "editor"; templateId?: string; clone?: boolean } | { mode: "run"; runId: string };

const SUBJECT_LABEL: Record<string, string> = { deal: "Deal", contact: "Contact", company: "Company", freeform: "Anything" };
const RUN_STAGES = ["gathering", "synthesizing", "validating", "ready"] as const;
const STAGE_TEXT: Record<string, string> = {
  queued: "Queued", gathering: "Gathering sources", synthesizing: "Synthesizing report", validating: "Validating", ready: "Ready", failed: "Failed",
};

async function jsonFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  return (await res.json()) as T;
}

export default function ResearchStudioClient(props: Props) {
  const { accent } = props;
  const toast = useToast();
  const [view, setView] = useState<View>(props.initialRunId ? { mode: "run", runId: props.initialRunId } : { mode: "home" });
  const [templates, setTemplates] = useState(props.initialTemplates);
  const [runs, setRuns] = useState(props.initialRuns);
  const [triggers, setTriggers] = useState<ResearchTrigger[]>(props.initialTriggers ?? []);
  const [runModalFor, setRunModalFor] = useState<TemplateDetail | null>(null);

  const refreshTemplates = useCallback(async () => {
    const d = await jsonFetch<{ items: ResearchTemplateItem[] }>("/api/research/templates");
    setTemplates(d.items ?? []);
  }, []);
  const refreshRuns = useCallback(async () => {
    const d = await jsonFetch<{ items: ResearchRunItem[] }>("/api/research/runs");
    setRuns(d.items ?? []);
  }, []);
  const refreshTriggers = useCallback(async () => {
    const d = await jsonFetch<{ triggers: ResearchTrigger[] }>("/api/research/triggers");
    setTriggers(d.triggers ?? []);
  }, []);

  // ── Header ──────────────────────────────────────────────────────────────────
  const header = (
    <div className="page-header">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: accent + "18" }}>
            <Telescope className="w-5 h-5" style={{ color: accent }} />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-slate-800">Research Studio</h1>
            <p className="text-sm text-slate-500">Define what to research and how the report looks, then run it on any prospect, deal or company.</p>
          </div>
        </div>
        {view.mode === "home" && (
          <Button onClick={() => setView({ mode: "editor" })} style={{ background: accent }}>
            <Plus className="w-4 h-4" /> New template
          </Button>
        )}
      </div>
    </div>
  );

  if (props.licenseError) {
    return (
      <div>
        {header}
        <EmptyState
          icon={<Sparkles className="w-7 h-7 mx-auto" style={{ color: accent }} />}
          title="Research Studio isn't on your plan yet"
          description={props.licenseError}
        />
      </div>
    );
  }

  return (
    <div>
      {header}

      {view.mode === "home" && (
        <HomeView
          accent={accent}
          templates={templates}
          runs={runs}
          catalog={props.catalog}
          triggers={triggers}
          pipelines={props.pipelines ?? []}
          onAddTrigger={async (stageId, templateId) => {
            const d = await jsonFetch<{ ok: boolean; error?: string }>("/api/research/triggers", { method: "POST", body: JSON.stringify({ stageId, templateId, fast: true }) });
            if (d.ok) { toast.push("Auto-run added", "success"); refreshTriggers(); }
            else toast.push(d.error ?? "Couldn't add", "error");
          }}
          onRemoveTrigger={async (stageId) => {
            const d = await jsonFetch<{ ok: boolean }>(`/api/research/triggers/${encodeURIComponent(stageId)}`, { method: "DELETE" });
            if (d.ok) { toast.push("Auto-run removed", "success"); refreshTriggers(); }
          }}
          onNew={() => setView({ mode: "editor" })}
          onEdit={(id) => setView({ mode: "editor", templateId: id })}
          onClone={(id) => setView({ mode: "editor", templateId: id, clone: true })}
          onRun={async (id) => {
            const d = await jsonFetch<{ ok: boolean; template?: TemplateDetail }>(`/api/research/templates/${id}`);
            if (d.template) setRunModalFor(d.template);
          }}
          onOpenRun={(runId) => setView({ mode: "run", runId })}
          onDelete={async (id) => {
            const d = await jsonFetch<{ ok: boolean; error?: string }>(`/api/research/templates/${id}`, { method: "DELETE" });
            if (d.ok) { toast.push("Template deleted", "success"); refreshTemplates(); }
            else toast.push(d.error ?? "Couldn't delete", "error");
          }}
        />
      )}

      {view.mode === "editor" && (
        <TemplateEditor
          accent={accent}
          templateId={view.templateId}
          clone={view.clone}
          catalog={props.catalog}
          onCancel={() => setView({ mode: "home" })}
          onSaved={() => { setView({ mode: "home" }); refreshTemplates(); toast.push("Template saved", "success"); }}
        />
      )}

      {view.mode === "run" && (
        <RunView
          accent={accent}
          runId={view.runId}
          onBack={() => { setView({ mode: "home" }); refreshRuns(); }}
          onOpenRun={(rid) => { setView({ mode: "run", runId: rid }); refreshRuns(); }}
        />
      )}

      {runModalFor && (
        <RunModal
          accent={accent}
          template={runModalFor}
          onClose={() => setRunModalFor(null)}
          onStarted={(runId) => { setRunModalFor(null); refreshRuns(); setView({ mode: "run", runId }); }}
        />
      )}
    </div>
  );
}

// ── Home: templates gallery + recent runs ─────────────────────────────────────
function HomeView(props: {
  accent: string;
  templates: ResearchTemplateItem[];
  runs: ResearchRunItem[];
  catalog: ResearchSourceCatalog | null;
  triggers: ResearchTrigger[];
  pipelines: PipelineRow[];
  onAddTrigger: (stageId: string, templateId: string) => void;
  onRemoveTrigger: (stageId: string) => void;
  onNew: () => void;
  onEdit: (id: string) => void;
  onClone: (id: string) => void;
  onRun: (id: string) => void;
  onOpenRun: (runId: string) => void;
  onDelete: (id: string) => void;
}) {
  const { accent, templates, runs } = props;
  // Only nudge about web search when the API reports it isn't configured.
  const noSearch = props.catalog?.searchConfigured === false;
  const noAi = props.catalog?.aiConfigured === false;

  return (
    <div>
      {noAi && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          <strong>No AI provider configured.</strong> Reports will show raw sources only (no analysis). Add an OpenAI or Anthropic key in <a href="/integrations" style={{ color: "#991b1b", textDecoration: "underline" }}>Integrations</a> (or set <code>OPENAI_API_KEY</code> on the API) to generate full reports.
        </div>
      )}
      {noSearch && (
        <div style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", borderRadius: 10, padding: "10px 14px", fontSize: 13, marginBottom: 16 }}>
          Tip: add a <strong>Tavily</strong> key in <a href="/integrations" style={{ color: "#92400e", textDecoration: "underline" }}>Integrations</a> or set <code>SEARXNG_URL</code> on the API to enable web search. Crawl &amp; site-performance still work without it.
        </div>
      )}

      <h2 className="text-sm font-semibold text-slate-700 mb-3">Templates</h2>
      {templates.length === 0 ? (
        <EmptyState
          icon={<Telescope className="w-7 h-7 mx-auto" style={{ color: accent }} />}
          title="No templates yet"
          description="Start from a built-in or create your own — choose a subject, the sources to gather, and the sections your report should contain."
          action={<Button onClick={props.onNew} style={{ background: accent }}><Plus className="w-4 h-4" /> New template</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {templates.map((tpl) => (
            <Card key={tpl.id} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: accent + "12" }}>
                  <Telescope className="w-5 h-5" style={{ color: accent }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontWeight: 600, color: t.color.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{tpl.name}</span>
                    {tpl.isBuiltIn && <Badge tone="accent">Starter</Badge>}
                  </div>
                  <div style={{ color: t.color.textMuted, fontSize: t.font.xs, marginTop: 2 }}>{tpl.description || "—"}</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <Badge>{SUBJECT_LABEL[tpl.subjectType] ?? tpl.subjectType}</Badge>
                <Badge>{tpl.sectionCount} sections</Badge>
                <Badge>{tpl.sourceCount} sources</Badge>
              </div>
              <div style={{ display: "flex", gap: 6, marginTop: "auto", paddingTop: 4 }}>
                <Button size="sm" onClick={() => props.onRun(tpl.id)} style={{ background: accent }}><Play className="w-3.5 h-3.5" /> Run</Button>
                {tpl.isBuiltIn ? (
                  <Button size="sm" variant="secondary" onClick={() => props.onClone(tpl.id)}><Copy className="w-3.5 h-3.5" /> Duplicate</Button>
                ) : (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => props.onEdit(tpl.id)}><Pencil className="w-3.5 h-3.5" /> Edit</Button>
                    <Button size="sm" variant="ghost" onClick={() => props.onClone(tpl.id)} title="Duplicate"><Copy className="w-3.5 h-3.5" /></Button>
                    {tpl.isOwner && (
                      <Button size="sm" variant="danger" onClick={() => props.onDelete(tpl.id)} title="Delete"><Trash2 className="w-3.5 h-3.5" /></Button>
                    )}
                  </>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      <h2 className="text-sm font-semibold text-slate-700 mb-3" style={{ display: "flex", alignItems: "center", gap: 6 }}><Zap className="w-4 h-4" style={{ color: accent }} /> Auto-run on deal stage</h2>
      <TriggersCard
        accent={accent}
        triggers={props.triggers}
        pipelines={props.pipelines}
        templates={templates}
        onAdd={props.onAddTrigger}
        onRemove={props.onRemoveTrigger}
      />
      <div style={{ height: 28 }} />

      <h2 className="text-sm font-semibold text-slate-700 mb-3">Recent runs</h2>
      {runs.length === 0 ? (
        <Card style={{ color: t.color.textMuted, fontSize: t.font.sm }}>No runs yet — pick a template and hit Run.</Card>
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {runs.map((r, i) => (
            <button
              key={r.id}
              onClick={() => props.onOpenRun(r.id)}
              style={{
                display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left",
                padding: "12px 16px", background: "transparent", border: "none", borderTop: i ? `1px solid ${t.color.border}` : "none", cursor: "pointer",
              }}
            >
              <RunStatusBadge status={r.status} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600, color: t.color.text, fontSize: t.font.sm, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.subjectLabel || r.templateName}
                </div>
                <div style={{ color: t.color.textFaint, fontSize: t.font.xs }}>{r.templateName} · {new Date(r.createdAt).toLocaleString()}</div>
              </div>
              {r.score != null && <ScoreChip score={r.score} accent={accent} />}
            </button>
          ))}
        </Card>
      )}
    </div>
  );
}

// ── Triggers: auto-run research when a deal enters a stage ────────────────────
function TriggersCard(props: {
  accent: string;
  triggers: ResearchTrigger[];
  pipelines: PipelineRow[];
  templates: ResearchTemplateItem[];
  onAdd: (stageId: string, templateId: string) => void;
  onRemove: (stageId: string) => void;
}) {
  const { accent, triggers, pipelines, templates } = props;
  const stages = pipelines.flatMap((p) => p.stages.map((s) => ({ id: s.id, label: `${p.name} · ${s.name}` })));
  const [stageId, setStageId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const stageLabel = (id: string) => stages.find((s) => s.id === id)?.label ?? "Unknown stage";
  const tplName = (id: string) => templates.find((tt) => tt.id === id)?.name ?? id;

  if (pipelines.length === 0) {
    return <Card style={{ color: t.color.textMuted, fontSize: t.font.sm }}>Create a deal pipeline first to enable stage-based auto-research.</Card>;
  }

  return (
    <Card>
      <div style={{ color: t.color.textMuted, fontSize: t.font.sm, marginBottom: 12 }}>
        When a deal enters a stage, automatically run a research template against it. Results land on the deal&apos;s timeline.
      </div>
      {triggers.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
          {triggers.map((trig) => (
            <div key={trig.stageId} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", border: `1px solid ${t.color.border}`, borderRadius: t.radius.md }}>
              <Badge tone="accent">{stageLabel(trig.stageId)}</Badge>
              <span style={{ color: t.color.textFaint }}>→</span>
              <span style={{ fontWeight: 600, color: t.color.text, fontSize: t.font.sm }}>{tplName(trig.templateId)}</span>
              <Badge tone="success">fast</Badge>
              <Button size="sm" variant="ghost" style={{ marginLeft: "auto" }} onClick={() => props.onRemove(trig.stageId)}><X className="w-4 h-4" /></Button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <Select value={stageId} onChange={(e) => setStageId(e.target.value)} style={{ width: 220 }}>
          <option value="">Choose a stage…</option>
          {stages.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
        </Select>
        <span style={{ color: t.color.textFaint }}>→</span>
        <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)} style={{ width: 220 }}>
          <option value="">Choose a template…</option>
          {templates.map((tt) => <option key={tt.id} value={tt.id}>{tt.name}</option>)}
        </Select>
        <Button size="sm" disabled={!stageId || !templateId} style={{ background: accent }}
          onClick={() => { props.onAdd(stageId, templateId); setStageId(""); setTemplateId(""); }}>
          <Plus className="w-3.5 h-3.5" /> Add
        </Button>
      </div>
    </Card>
  );
}

// ── Run modal: collect inputs, then enqueue ───────────────────────────────────
function RunModal(props: { accent: string; template: TemplateDetail; onClose: () => void; onStarted: (runId: string) => void }) {
  const { template, accent } = props;
  const toast = useToast();
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const subjectLabel = values.name ?? Object.values(values)[0] ?? template.name;
      const d = await jsonFetch<{ ok: boolean; id?: string; error?: string }>("/api/research/runs", {
        method: "POST",
        body: JSON.stringify({ templateId: template.id, inputs: values, subjectType: template.subjectType, subjectLabel }),
      });
      if (d.ok && d.id) props.onStarted(d.id);
      else { toast.push(d.error ?? "Couldn't start run", "error"); setBusy(false); }
    } catch {
      toast.push("Couldn't start run", "error");
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Run: ${template.name}`}
      onClose={props.onClose}
      width={520}
      footer={
        <>
          <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
          <Button onClick={submit} disabled={busy} style={{ background: accent }}>
            {busy ? <Spinner size={14} /> : <Play className="w-4 h-4" />} Run research
          </Button>
        </>
      }
    >
      <p style={{ color: t.color.textMuted, fontSize: t.font.sm, marginTop: 0 }}>
        Fill in what you know — the more context, the better the report.
      </p>
      {template.inputs.length === 0 && (
        <Field label="Subject"><Input autoFocus placeholder="Who/what to research" value={values.name ?? ""} onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))} /></Field>
      )}
      {template.inputs.map((inp, i) => (
        <Field key={inp.key} label={inp.label + (inp.required ? " *" : "")}>
          <Input
            autoFocus={i === 0}
            placeholder={inp.label}
            value={values[inp.key] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [inp.key]: e.target.value }))}
          />
        </Field>
      ))}
    </Modal>
  );
}

// ── Run view: live progress + branded preview ─────────────────────────────────
function RunView(props: { accent: string; runId: string; onBack: () => void; onOpenRun: (runId: string) => void }) {
  const { accent, runId } = props;
  const toast = useToast();
  const [run, setRun] = useState<RunDetail | null>(null);
  const [rerunning, setRerunning] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rerun = async () => {
    setRerunning(true);
    try {
      const d = await jsonFetch<{ ok: boolean; id?: string; error?: string }>(`/api/research/runs/${runId}/rerun`, { method: "POST" });
      if (d.ok && d.id) props.onOpenRun(d.id);
      else { toast.push(d.error ?? "Couldn't re-run", "error"); setRerunning(false); }
    } catch { toast.push("Couldn't re-run", "error"); setRerunning(false); }
  };

  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const d = await jsonFetch<{ ok: boolean; run?: RunDetail }>(`/api/research/runs/${runId}`);
        if (!active) return;
        if (d.run) {
          setRun(d.run);
          if (d.run.status !== "ready" && d.run.status !== "failed") {
            timer.current = setTimeout(poll, 1800);
          }
        }
      } catch {
        if (active) timer.current = setTimeout(poll, 3000);
      }
    };
    poll();
    return () => { active = false; if (timer.current) clearTimeout(timer.current); };
  }, [runId]);

  const back = <Button variant="ghost" onClick={props.onBack} style={{ marginBottom: 12 }}><ArrowLeft className="w-4 h-4" /> Back to Studio</Button>;

  if (!run) return <div>{back}<Card style={{ textAlign: "center", padding: 40 }}><Spinner /></Card></div>;

  const inProgress = run.status !== "ready" && run.status !== "failed";

  return (
    <div>
      {back}
      <Card style={{ marginBottom: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontWeight: 700, fontSize: t.font.xl, color: t.color.text }}>{run.subjectLabel || run.templateName}</div>
            <div style={{ color: t.color.textMuted, fontSize: t.font.sm }}>{run.templateName} · {SUBJECT_LABEL[run.subjectType] ?? run.subjectType}</div>
          </div>
          {run.status === "ready" && run.score != null && <ScoreChip score={run.score} accent={accent} big />}
        </div>

        {inProgress && <ProgressStepper status={run.status} progress={run.progress} accent={accent} />}

        {run.status === "ready" && (
          <>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 14, alignItems: "center" }}>
              <a href={`/api/research/runs/${runId}/export?format=pdf`}><Button size="sm" style={{ background: accent }}><FileDown className="w-3.5 h-3.5" /> PDF</Button></a>
              <a href={`/api/research/runs/${runId}/export?format=csv`}><Button size="sm" variant="secondary"><FileDown className="w-3.5 h-3.5" /> CSV</Button></a>
              <a href={`/api/research/runs/${runId}/export?format=html`} target="_blank" rel="noreferrer"><Button size="sm" variant="secondary"><ExternalLink className="w-3.5 h-3.5" /> Branded report</Button></a>
              <Button size="sm" variant="secondary" onClick={rerun} disabled={rerunning}>{rerunning ? <Spinner size={13} /> : <RotateCw className="w-3.5 h-3.5" />} Re-run</Button>
            </div>
            {usageSummary(run.usage) && (
              <div style={{ marginTop: 10, fontSize: t.font.xs, color: t.color.textFaint }}>{usageSummary(run.usage)}</div>
            )}
          </>
        )}
      </Card>

      {run.status === "failed" && (
        <Card style={{ borderColor: t.color.danger, background: t.color.dangerSoft }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", color: t.color.danger, fontWeight: 600 }}>
            <AlertTriangle className="w-5 h-5" /> Run failed
          </div>
          <div style={{ color: t.color.text, fontSize: t.font.sm, marginTop: 6 }}>{run.error || "Something went wrong."}</div>
          <div style={{ marginTop: 12 }}>
            <Button size="sm" variant="secondary" onClick={rerun} disabled={rerunning}>{rerunning ? <Spinner size={13} /> : <RotateCw className="w-3.5 h-3.5" />} Re-run</Button>
          </div>
        </Card>
      )}

      {run.status === "ready" && run.result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {run.result.sections.map((s) => (
            <Card key={s.id}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ fontWeight: 600, fontSize: t.font.lg, color: t.color.text }}>{s.title}</div>
                {s.score != null && <ScoreChip score={s.score} accent={accent} />}
              </div>
              <SectionBody content={s.content} />
              {s.table && s.table.headers.length > 0 && <ResultTable table={s.table} />}
            </Card>
          ))}

          {run.result.sources && run.result.sources.length > 0 && (
            <Card>
              <div style={{ fontWeight: 600, fontSize: t.font.lg, color: t.color.text, marginBottom: 8 }}>Sources</div>
              <ol style={{ margin: 0, paddingLeft: 20, color: t.color.textMuted, fontSize: t.font.xs, lineHeight: 1.7 }}>
                {run.result.sources.map((c) => (
                  <li key={c.n}>
                    {c.url ? <a href={c.url} target="_blank" rel="noreferrer" style={{ color: accent }}>{c.title || c.url}</a> : c.title}
                  </li>
                ))}
              </ol>
            </Card>
          )}

          <div style={{ fontSize: t.font.xs, color: t.color.textFaint, textAlign: "center", padding: "4px 0 8px" }}>
            AI-generated from the cited sources — verify key facts (figures, names, dates) before acting.
          </div>
        </div>
      )}
    </div>
  );
}

// Render inline **bold** (and strip stray markdown heading marks) safely — no
// dangerouslySetInnerHTML, just React nodes.
function inlineMd(s: string): React.ReactNode {
  const clean = s.replace(/^#{1,6}\s+/, "");
  const parts = clean.split(/\*\*(.+?)\*\*/g); // odd indices are the bold captures
  return parts.map((p, i) => (i % 2 === 1 ? <strong key={i}>{p}</strong> : p));
}

function SectionBody({ content }: { content: string }) {
  const block = splitSectionContent(content);
  if (block.kind === "list") {
    return (
      <ul style={{ margin: 0, paddingLeft: 18, color: t.color.text, fontSize: t.font.sm, lineHeight: 1.6 }}>
        {block.items.map((b, i) => <li key={i} style={{ marginBottom: 3 }}>{inlineMd(b)}</li>)}
      </ul>
    );
  }
  const lines = block.text.split("\n").map((l) => l.trim());
  return (
    <div style={{ color: t.color.text, fontSize: t.font.sm, lineHeight: 1.65 }}>
      {lines.map((ln, i) => (ln ? <p key={i} style={{ margin: "0 0 8px" }}>{inlineMd(ln)}</p> : null))}
    </div>
  );
}

function ResultTable({ table }: { table: SynthTable }) {
  return (
    <div style={{ overflowX: "auto", marginTop: 12 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: t.font.sm }}>
        <thead>
          <tr>{table.headers.map((h, i) => (
            <th key={i} style={{ textAlign: "left", padding: "7px 10px", background: t.color.surfaceMuted, color: t.color.textMuted, borderBottom: `1px solid ${t.color.border}`, fontWeight: 600 }}>{h}</th>
          ))}</tr>
        </thead>
        <tbody>
          {table.rows.map((row, ri) => (
            <tr key={ri}>{row.map((c, ci) => (
              <td key={ci} style={{ padding: "7px 10px", borderBottom: `1px solid ${t.color.border}`, color: t.color.text, verticalAlign: "top" }}>{c}</td>
            ))}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ProgressStepper({ status, progress, accent }: { status: string; progress: number; accent: string }) {
  const activeIdx = RUN_STAGES.indexOf(status as (typeof RUN_STAGES)[number]);
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ height: 8, background: t.color.surfaceMuted, borderRadius: 999, overflow: "hidden" }}>
        <div style={{ height: "100%", width: `${Math.max(8, progress)}%`, background: accent, borderRadius: 999, transition: "width 600ms ease" }} />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {RUN_STAGES.map((st, i) => {
          const done = activeIdx > i;
          const current = activeIdx === i || (status === "queued" && i === 0);
          return (
            <div key={st} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: t.font.xs, fontWeight: 600, color: current ? accent : done ? t.color.text : t.color.textFaint }}>
              {done ? <CheckCircle2 className="w-3.5 h-3.5" /> : current ? <Spinner size={13} /> : <span style={{ width: 13, height: 13, borderRadius: 999, border: `2px solid ${t.color.border}`, display: "inline-block" }} />}
              {STAGE_TEXT[st]}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Template editor ───────────────────────────────────────────────────────────
const BLANK: TemplateDef = {
  name: "", description: "", subjectType: "freeform",
  inputs: [{ key: "name", label: "Subject name", required: true }, { key: "website", label: "Website URL" }],
  sources: { webSearch: { enabled: true, queries: ["{name}"] }, crawl: { enabled: true, seeds: ["{website}"], maxPages: 5 }, pagespeed: { enabled: false } },
  sections: [{ id: "overview", title: "Overview", prompt: "Summarise {name} using the research.", outputs: ["text"] }],
};

function TemplateEditor(props: {
  accent: string; templateId?: string; clone?: boolean; catalog: ResearchSourceCatalog | null;
  onCancel: () => void; onSaved: () => void;
}) {
  const { accent } = props;
  const toast = useToast();
  const [def, setDef] = useState<TemplateDef | null>(props.templateId ? null : BLANK);
  const [busy, setBusy] = useState(false);
  const outputs = (props.catalog?.outputs as SectionOutput[]) ?? ["text", "table", "score"];
  const subjectTypes = props.catalog?.subjectTypes ?? ["deal", "contact", "company", "freeform"];

  useEffect(() => {
    if (!props.templateId) return;
    (async () => {
      const d = await jsonFetch<{ ok: boolean; template?: TemplateDetail }>(`/api/research/templates/${props.templateId}`);
      if (d.template) {
        const { id, isBuiltIn, isOwner, ...rest } = d.template;
        void id; void isBuiltIn; void isOwner;
        setDef({ ...rest, name: props.clone ? `${rest.name} (copy)` : rest.name });
      } else {
        setDef(BLANK);
      }
    })();
  }, [props.templateId, props.clone]);

  if (!def) return <Card style={{ textAlign: "center", padding: 40 }}><Spinner /></Card>;

  const editing = Boolean(props.templateId) && !props.clone;
  const update = (patch: Partial<TemplateDef>) => setDef((d) => (d ? { ...d, ...patch } : d));

  const save = async () => {
    if (!def.name.trim()) { toast.push("Give the template a name", "error"); return; }
    setBusy(true);
    const url = editing ? `/api/research/templates/${props.templateId}` : "/api/research/templates";
    const method = editing ? "PUT" : "POST";
    const d = await jsonFetch<{ ok: boolean; error?: string }>(url, { method, body: JSON.stringify(def) });
    setBusy(false);
    if (d.ok) props.onSaved();
    else toast.push(d.error ?? "Couldn't save", "error");
  };

  const src = def.sources;
  const setSrc = (patch: Partial<TemplateSources>) => update({ sources: { ...src, ...patch } });

  return (
    <div style={{ maxWidth: 760 }}>
      <Button variant="ghost" onClick={props.onCancel} style={{ marginBottom: 12 }}><ArrowLeft className="w-4 h-4" /> Cancel</Button>

      {/* Step 1 — basics */}
      <Card style={{ marginBottom: 14 }}>
        <SectionLabel n={1} text="Subject & details" accent={accent} />
        <Field label="Template name"><Input value={def.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Pre-Call Deal Brief" /></Field>
        <Field label="Description"><Input value={def.description ?? ""} onChange={(e) => update({ description: e.target.value })} placeholder="What this template is for" /></Field>
        <Field label="Subject type" hint="What each run is about. Contextual runs from a deal/contact/company prefill inputs automatically.">
          <Select value={def.subjectType} onChange={(e) => update({ subjectType: e.target.value })}>
            {subjectTypes.map((s) => <option key={s} value={s}>{SUBJECT_LABEL[s] ?? s}</option>)}
          </Select>
        </Field>
        <Label2 text="Inputs" />
        {def.inputs.map((inp, i) => (
          <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8 }}>
            <Input placeholder="key (e.g. website)" value={inp.key} onChange={(e) => update({ inputs: def.inputs.map((x, j) => j === i ? { ...x, key: e.target.value.replace(/[^a-zA-Z0-9_]/g, "") } : x) })} style={{ flex: 1 }} />
            <Input placeholder="Label" value={inp.label} onChange={(e) => update({ inputs: def.inputs.map((x, j) => j === i ? { ...x, label: e.target.value } : x) })} style={{ flex: 2 }} />
            <Button variant="ghost" size="sm" onClick={() => update({ inputs: def.inputs.filter((_, j) => j !== i) })}><X className="w-4 h-4" /></Button>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={() => update({ inputs: [...def.inputs, { key: "", label: "" }] })}><Plus className="w-3.5 h-3.5" /> Add input</Button>
      </Card>

      {/* Step 2 — sources */}
      <Card style={{ marginBottom: 14 }}>
        <SectionLabel n={2} text="Sources" accent={accent} />
        <SourceToggle
          icon={<Search className="w-4 h-4" />} label="Web Search" hint="Self-hosted SearXNG — free, no per-query fee"
          enabled={!!src.webSearch?.enabled} onToggle={(v) => setSrc({ webSearch: { ...src.webSearch, enabled: v } })}
        >
          <Field label="Queries (one per line — use {key} tokens)">
            <Textarea
              value={(src.webSearch?.queries ?? []).join("\n")}
              onChange={(e) => setSrc({ webSearch: { enabled: !!src.webSearch?.enabled, queries: e.target.value.split("\n") } })}
              placeholder={"{name} news\n{name} competitors"}
            />
          </Field>
        </SourceToggle>
        <SourceToggle
          icon={<Globe className="w-4 h-4" />} label="Website Crawl" hint="Fetches & reads the pages you seed — free"
          enabled={!!src.crawl?.enabled} onToggle={(v) => setSrc({ crawl: { ...src.crawl, enabled: v } })}
        >
          <Field label="Seed URLs (one per line)">
            <Textarea value={(src.crawl?.seeds ?? []).join("\n")} onChange={(e) => setSrc({ crawl: { enabled: !!src.crawl?.enabled, seeds: e.target.value.split("\n"), maxPages: src.crawl?.maxPages } })} placeholder="{website}" />
          </Field>
          <Field label="Max pages">
            <Input type="number" min={1} max={10} value={src.crawl?.maxPages ?? 5} onChange={(e) => setSrc({ crawl: { enabled: !!src.crawl?.enabled, seeds: src.crawl?.seeds, maxPages: Number(e.target.value) } })} style={{ width: 120 }} />
          </Field>
        </SourceToggle>
        <SourceToggle
          icon={<Gauge className="w-4 h-4" />} label="Site Performance" hint="Google PageSpeed Insights — free"
          enabled={!!src.pagespeed?.enabled} onToggle={(v) => setSrc({ pagespeed: { enabled: v } })}
        />
      </Card>

      {/* Step 3 — sections */}
      <Card style={{ marginBottom: 14 }}>
        <SectionLabel n={3} text="Report structure" accent={accent} />
        {def.sections.map((sec, i) => (
          <div key={i} style={{ border: `1px solid ${t.color.border}`, borderRadius: t.radius.md, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <Input placeholder="Section title" value={sec.title} onChange={(e) => update({ sections: def.sections.map((x, j) => j === i ? { ...x, title: e.target.value } : x) })} style={{ flex: 1 }} />
              <Button variant="ghost" size="sm" onClick={() => update({ sections: def.sections.filter((_, j) => j !== i) })}><Trash2 className="w-4 h-4" /></Button>
            </div>
            <Textarea placeholder="Instruction for the AI for this section" value={sec.prompt} onChange={(e) => update({ sections: def.sections.map((x, j) => j === i ? { ...x, prompt: e.target.value } : x) })} style={{ marginBottom: 8, minHeight: 56 }} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {outputs.map((o) => {
                const on = sec.outputs.includes(o);
                return (
                  <button key={o} type="button"
                    onClick={() => update({ sections: def.sections.map((x, j) => j === i ? { ...x, outputs: on ? x.outputs.filter((y) => y !== o) : [...x.outputs, o] } : x) })}
                    style={{ padding: "4px 12px", borderRadius: 999, fontSize: t.font.xs, fontWeight: 600, cursor: "pointer", border: `1px solid ${on ? accent : t.color.border}`, background: on ? accent + "14" : "transparent", color: on ? accent : t.color.textMuted }}>
                    {o}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
        <Button variant="secondary" size="sm" onClick={() => update({ sections: [...def.sections, { title: "", prompt: "", outputs: ["text"] }] })}><Plus className="w-3.5 h-3.5" /> Add section</Button>
      </Card>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginBottom: 40 }}>
        <Button variant="secondary" onClick={props.onCancel}>Cancel</Button>
        <Button onClick={save} disabled={busy} style={{ background: accent }}>{busy ? <Spinner size={14} /> : null} {editing ? "Save changes" : "Create template"}</Button>
      </div>
    </div>
  );
}

// ── Small shared bits ─────────────────────────────────────────────────────────
function SectionLabel({ n, text, accent }: { n: number; text: string; accent: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <span style={{ width: 22, height: 22, borderRadius: 999, background: accent + "18", color: accent, fontSize: 12, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{n}</span>
      <span style={{ fontWeight: 600, fontSize: t.font.lg, color: t.color.text }}>{text}</span>
    </div>
  );
}
function Label2({ text }: { text: string }) {
  return <div style={{ fontSize: t.font.sm, fontWeight: 600, color: t.color.text, margin: "6px 0 8px" }}>{text}</div>;
}
function SourceToggle(props: { icon: React.ReactNode; label: string; hint: string; enabled: boolean; onToggle: (v: boolean) => void; children?: React.ReactNode }) {
  return (
    <div style={{ borderTop: `1px solid ${t.color.border}`, padding: "12px 0" }}>
      <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
        <input type="checkbox" checked={props.enabled} onChange={(e) => props.onToggle(e.target.checked)} style={{ width: 16, height: 16 }} />
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontWeight: 600, color: t.color.text }}>{props.icon}{props.label}</span>
        <Badge tone="success">free</Badge>
        <span style={{ color: t.color.textFaint, fontSize: t.font.xs }}>{props.hint}</span>
      </label>
      {props.enabled && props.children && <div style={{ marginTop: 10, paddingLeft: 26 }}>{props.children}</div>}
    </div>
  );
}
function ScoreChip({ score, accent, big }: { score: number; accent: string; big?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", lineHeight: 1 }}>
      <span style={{ fontSize: big ? 34 : 20, fontWeight: 800, color: accent }}>{score}</span>
      <span style={{ fontSize: t.font.xs, color: t.color.textFaint }}>/ 100</span>
    </div>
  );
}
function RunStatusBadge({ status }: { status: string }) {
  if (status === "ready") return <Badge tone="success">Ready</Badge>;
  if (status === "failed") return <Badge tone="danger">Failed</Badge>;
  if (status === "queued") return <Badge>Queued</Badge>;
  return <Badge tone="accent">{STAGE_TEXT[status] ?? "Running"}</Badge>;
}
