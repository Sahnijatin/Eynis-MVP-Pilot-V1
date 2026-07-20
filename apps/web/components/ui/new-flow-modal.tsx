"use client";

import { useState } from "react";
import { Button, Modal, Field, Input, Select, Textarea, Spinner, useToast, tokens as t } from "../ds";
import type { AutomationsResponse } from "../../lib/data";

type FlowItem = AutomationsResponse["items"][number];

// Trigger/action vocabulary — keys MUST match apps/api/src/core/automations/flow.ts.
export const FLOW_TRIGGERS: Array<{ value: string; label: string }> = [
  { value: "new_lead", label: "New lead / enquiry lands" },
  { value: "quote_sent", label: "Quote / estimate sent" },
  { value: "quote_no_response", label: "Quote sent · no response" },
  { value: "deal_stage_changed", label: "Deal changes stage" },
  { value: "deal_won", label: "Deal won" },
  { value: "deal_lost", label: "Deal lost / abandoned" },
  { value: "order_delivered", label: "Order delivered" },
  { value: "contact_dormant", label: "Contact goes dormant" },
  { value: "task_overdue", label: "Task overdue" },
];
export const FLOW_ACTIONS: Array<{ value: string; label: string }> = [
  { value: "send_whatsapp", label: "Send a WhatsApp message" },
  { value: "send_email", label: "Send an email" },
  { value: "multi_touch_followup", label: "Start multi-touch follow-up" },
  { value: "nurture_drip", label: "Send nurture content drip" },
  { value: "create_task", label: "Create a follow-up task" },
  { value: "notify_team", label: "Notify the team" },
  { value: "ask_review", label: "Ask for a review / referral" },
];
const CHANNELS: Array<{ value: string; label: string }> = [
  { value: "whatsapp", label: "WhatsApp" },
  { value: "email", label: "Email" },
  { value: "sms", label: "SMS" },
];
// Triggers where a wait window is meaningful — the delay field only shows for these.
const DELAY_TRIGGERS = new Set(["quote_no_response", "contact_dormant", "task_overdue"]);
// Actions that enroll the contact into a drip Sequence — show the sequence picker.
const SEQUENCE_ACTIONS = new Set(["multi_touch_followup", "nurture_drip"]);

export interface SequenceOption { id: string; name: string }

export interface FlowPrefill {
  name?: string;
  trigger?: string;
  action?: string;
  channels?: string[];
  delayHours?: number;
  detail?: string;
}

export function NewFlowModal({ prefill, sequences = [], onClose, onCreated }: {
  prefill?: FlowPrefill;
  sequences?: SequenceOption[];
  onClose: () => void;
  onCreated: (rule: FlowItem) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(prefill?.name ?? "");
  const [trigger, setTrigger] = useState(prefill?.trigger ?? "new_lead");
  const [action, setAction] = useState(prefill?.action ?? "send_whatsapp");
  const [channels, setChannels] = useState<Set<string>>(new Set(prefill?.channels ?? ["whatsapp"]));
  const [delayHours, setDelayHours] = useState(prefill?.delayHours != null ? String(prefill.delayHours) : "");
  const [detail, setDetail] = useState(prefill?.detail ?? "");
  const [sequenceId, setSequenceId] = useState("");
  const [active, setActive] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggleChannel(v: string) {
    setChannels((prev) => {
      const next = new Set(prev);
      next.has(v) ? next.delete(v) : next.add(v);
      return next;
    });
  }

  async function submit() {
    if (!name.trim()) { setError("Flow name is required"); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/automations", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          trigger,
          action,
          channels: [...channels],
          delayHours: DELAY_TRIGGERS.has(trigger) && delayHours.trim() ? Number(delayHours) : 0,
          detail: detail.trim() || undefined,
          sequenceId: SEQUENCE_ACTIONS.has(action) && sequenceId ? sequenceId : undefined,
          isActive: active,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not create flow");
      toast.push("Flow created", "success");
      onCreated(data.rule as FlowItem);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create flow"); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="New Flow" onClose={onClose} width={520}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={submit} disabled={busy}>{busy ? <Spinner size={14} /> : "Create flow"}</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Flow name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Enquiry → 5-minute reply" autoFocus /></Field>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field label="When this happens (trigger)">
            <Select value={trigger} onChange={(e) => setTrigger(e.target.value)}>
              {FLOW_TRIGGERS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
          <Field label="Do this (action)">
            <Select value={action} onChange={(e) => setAction(e.target.value)}>
              {FLOW_ACTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </Select>
          </Field>
        </div>
        {SEQUENCE_ACTIONS.has(action) && (
          <Field label="Sequence to enroll into" hint={sequences.length === 0
            ? "No sequences yet — the contact gets a follow-up task until you create one in Sequences."
            : "Which drip sequence the contact is enrolled in."}>
            <Select value={sequenceId} onChange={(e) => setSequenceId(e.target.value)} disabled={sequences.length === 0}>
              <option value="">{sequences.length === 0 ? "None available" : "Auto — first active sequence"}</option>
              {sequences.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
        )}
        {DELAY_TRIGGERS.has(trigger) && (
          <Field label="Wait before firing (hours)" hint="optional — e.g. 72 for a 3-day wait">
            <Input type="number" min={0} value={delayHours} onChange={(e) => setDelayHours(e.target.value)} placeholder="0" />
          </Field>
        )}
        <Field label="Channels" hint="how the action reaches the customer">
          <div style={{ display: "flex", gap: 14, flexWrap: "wrap", paddingTop: 2 }}>
            {CHANNELS.map((c) => (
              <label key={c.value} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: t.font.sm, cursor: "pointer" }}>
                <input type="checkbox" checked={channels.has(c.value)} onChange={() => toggleChannel(c.value)} />
                {c.label}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Notes" hint="optional — describe what the flow does"><Textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={2} /></Field>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: t.font.sm, cursor: "pointer" }}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Activate immediately
        </label>
        {error && <div style={{ color: t.color.danger, fontSize: t.font.sm }}>{error}</div>}
      </div>
    </Modal>
  );
}
