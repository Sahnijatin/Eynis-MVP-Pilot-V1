"use client";

// Contextual "Research" button (RS-2). A trimmed, faster version of the Studio:
// embedded on a Contact/Company (or any record), it pre-fills inputs from the
// record, runs a *fast* template (cheap tier, fewer sources/sections) inline, and
// drops the result on the record's timeline (the API logs it automatically). The
// full report stays one click away in the Studio (/research?run=<id>).

import { useEffect, useState } from "react";
import { Telescope, Play, CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import { Button, Modal, Field, Input, Select, Spinner, Badge, tokens as t } from "../ds";

interface TemplateItem { id: string; name: string; subjectType: string; isBuiltIn: boolean }
interface TemplateInput { key: string; label: string; required?: boolean }
interface TemplateDetail { id: string; name: string; subjectType: string; inputs: TemplateInput[] }
interface SynthSection { id: string; title: string; content: string; score: number | null }
interface RunDetail {
  id: string; status: string; progress: number; stage: string | null; score: number | null; error: string | null;
  templateName: string; result: { sections: SynthSection[]; score: number | null } | null; gathered: { fetchedCount?: number } | null;
}

type SubjectType = "contact" | "company" | "deal";

interface Props {
  subjectType: SubjectType;
  subjectId: string;
  subjectLabel: string;
  prefill?: Record<string, string>;
  accent?: string;
  size?: "sm" | "md";
  variant?: "primary" | "secondary" | "ghost";
}

export default function ResearchButton(props: Props) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size={props.size ?? "sm"} variant={props.variant ?? "secondary"} onClick={() => setOpen(true)}>
        <Telescope className="w-3.5 h-3.5" /> Research
      </Button>
      {open && <ResearchDialog {...props} onClose={() => setOpen(false)} />}
    </>
  );
}

function ResearchDialog(props: Props & { onClose: () => void }) {
  const accent = props.accent ?? t.color.accent;
  const [phase, setPhase] = useState<"form" | "running" | "done">("form");
  const [templates, setTemplates] = useState<TemplateItem[]>([]);
  const [templateId, setTemplateId] = useState("");
  const [detail, setDetail] = useState<TemplateDetail | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [run, setRun] = useState<RunDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Load templates relevant to this subject (its type or free-form).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await fetch("/api/research/templates").then((r) => r.json());
        if (!active) return;
        const items: TemplateItem[] = d.items ?? [];
        const relevant = items.filter((i) => i.subjectType === props.subjectType || i.subjectType === "freeform");
        const list = relevant.length ? relevant : items;
        setTemplates(list);
        const def = list.find((i) => i.subjectType === props.subjectType) ?? list[0];
        if (def) setTemplateId(def.id);
        else setErr("No research templates available yet — create one in the Studio.");
      } catch {
        if (active) setErr("Couldn't load templates");
      }
    })();
    return () => { active = false; };
  }, [props.subjectType]);

  // Load the chosen template's inputs + prefill from the record.
  useEffect(() => {
    if (!templateId) return;
    let active = true;
    (async () => {
      const d = await fetch(`/api/research/templates/${templateId}`).then((r) => r.json());
      if (!active || !d.template) return;
      setDetail(d.template);
      const pre: Record<string, string> = {};
      const supplied = props.prefill ?? {};
      for (const inp of d.template.inputs as TemplateInput[]) {
        pre[inp.key] = supplied[inp.key] ?? (inp.key === "name" ? props.subjectLabel : "");
      }
      setValues(pre);
    })();
    return () => { active = false; };
  }, [templateId, props.prefill, props.subjectLabel]);

  // Poll the run while it's in flight.
  useEffect(() => {
    if (phase !== "running" || !run) return;
    if (run.status === "ready" || run.status === "failed") { setPhase("done"); return; }
    const id = setTimeout(async () => {
      try {
        const d = await fetch(`/api/research/runs/${run.id}`).then((r) => r.json());
        if (d.run) setRun(d.run);
      } catch { /* keep polling */ }
    }, 1800);
    return () => clearTimeout(id);
  }, [phase, run]);

  const start = async () => {
    setBusy(true); setErr(null);
    try {
      const d = await fetch("/api/research/runs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          templateId, fast: true, subjectType: props.subjectType, subjectId: props.subjectId,
          subjectLabel: props.subjectLabel, inputs: values,
        }),
      }).then((r) => r.json());
      if (d.ok && d.id) {
        setRun({ id: d.id, status: "queued", progress: 0, stage: "Queued", score: null, error: null, templateName: detail?.name ?? "", result: null, gathered: null });
        setPhase("running");
      } else {
        setErr(d.error ?? "Couldn't start research");
      }
    } catch {
      setErr("Couldn't start research");
    } finally {
      setBusy(false);
    }
  };

  const title = `Research: ${props.subjectLabel}`;

  // ── Footer per phase ────────────────────────────────────────────────────────
  let footer: React.ReactNode;
  if (phase === "form") {
    footer = (
      <>
        <Button variant="secondary" onClick={props.onClose}>Cancel</Button>
        <Button onClick={start} disabled={busy || !templateId} style={{ background: accent }}>
          {busy ? <Spinner size={14} /> : <Play className="w-4 h-4" />} Run research
        </Button>
      </>
    );
  } else if (phase === "running") {
    footer = <Button variant="secondary" onClick={props.onClose}>Run in background</Button>;
  } else {
    footer = (
      <>
        <Button variant="secondary" onClick={props.onClose}>Close</Button>
        {run && (
          <a href={`/research?run=${run.id}`} target="_blank" rel="noreferrer">
            <Button style={{ background: accent }}><ExternalLink className="w-4 h-4" /> Open full report</Button>
          </a>
        )}
      </>
    );
  }

  return (
    <Modal title={title} onClose={props.onClose} width={560} footer={footer}>
      {err && <div style={{ color: t.color.danger, fontSize: t.font.sm, marginBottom: 10 }}>{err}</div>}

      {phase === "form" && (
        <>
          <Field label="Template">
            <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((tpl) => <option key={tpl.id} value={tpl.id}>{tpl.name}{tpl.isBuiltIn ? " (starter)" : ""}</option>)}
            </Select>
          </Field>
          {detail?.inputs.map((inp, i) => (
            <Field key={inp.key} label={inp.label + (inp.required ? " *" : "")}>
              <Input autoFocus={i === 0} value={values[inp.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [inp.key]: e.target.value }))} placeholder={inp.label} />
            </Field>
          ))}
          <div style={{ fontSize: t.font.xs, color: t.color.textFaint, display: "flex", alignItems: "center", gap: 6 }}>
            <Badge tone="success">fast</Badge> Quick pass using free self-hosted sources. The full report opens in the Studio.
          </div>
        </>
      )}

      {phase === "running" && run && (
        <div style={{ textAlign: "center", padding: "12px 0" }}>
          <div style={{ height: 8, background: t.color.surfaceMuted, borderRadius: 999, overflow: "hidden", marginBottom: 14 }}>
            <div style={{ height: "100%", width: `${Math.max(8, run.progress)}%`, background: accent, borderRadius: 999, transition: "width 600ms ease" }} />
          </div>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 8, color: t.color.textMuted, fontSize: t.font.sm }}>
            <Spinner size={15} /> {run.stage ?? "Working"}…
          </div>
        </div>
      )}

      {phase === "done" && run && run.status === "failed" && (
        <div style={{ display: "flex", gap: 10, alignItems: "center", color: t.color.danger }}>
          <AlertTriangle className="w-5 h-5" /> <div><strong>Research failed.</strong><div style={{ color: t.color.text, fontSize: t.font.sm }}>{run.error}</div></div>
        </div>
      )}

      {phase === "done" && run && run.status === "ready" && run.result && (
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <CheckCircle2 className="w-5 h-5" style={{ color: t.color.success }} />
            <span style={{ fontWeight: 600, color: t.color.text }}>Ready</span>
            {run.score != null && <Badge tone="accent">Score {run.score}/100</Badge>}
            {run.gathered?.fetchedCount != null && <Badge>{run.gathered.fetchedCount} sources</Badge>}
            <span style={{ marginLeft: "auto", fontSize: t.font.xs, color: t.color.textFaint }}>Logged to timeline</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 320, overflow: "auto" }}>
            {run.result.sections.map((s) => (
              <div key={s.id} style={{ border: `1px solid ${t.color.border}`, borderRadius: t.radius.md, padding: 12 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 4 }}>
                  <span style={{ fontWeight: 600, color: t.color.text, fontSize: t.font.sm }}>{s.title}</span>
                  {s.score != null && <Badge tone="accent">{s.score}/100</Badge>}
                </div>
                <div style={{ fontSize: t.font.sm, color: t.color.text, lineHeight: 1.6, whiteSpace: "pre-wrap" }}>
                  {s.content.length > 400 ? `${s.content.slice(0, 400)}…` : s.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
