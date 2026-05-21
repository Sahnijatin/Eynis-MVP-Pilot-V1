"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, CheckCircle2, XCircle, Loader2, Eye, EyeOff } from "lucide-react";

interface ConnectorField {
  key: string;
  label: string;
  placeholder: string;
  secret?: boolean;
}

const connectorFields: Record<string, ConnectorField[]> = {
  whatsapp_twilio: [
    { key: "accountSid", label: "Account SID", placeholder: "ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" },
    { key: "authToken", label: "Auth Token", placeholder: "your_auth_token", secret: true },
    { key: "fromNumber", label: "WhatsApp From Number", placeholder: "+14155238886 or whatsapp:+14155238886" }
  ],
  whatsapp_interakt: [
    { key: "apiKey", label: "Interakt API Key", placeholder: "your_interakt_api_key", secret: true }
  ],
  cloudbeds_pms: [
    { key: "apiKey", label: "Cloudbeds API Key", placeholder: "cb_api_xxxxxxxx", secret: true },
    { key: "propertyId", label: "Property ID", placeholder: "12345" }
  ],
  stripe_payments: [
    { key: "secretKey", label: "Secret Key", placeholder: "sk_live_xxxxxxxx", secret: true },
    { key: "webhookSecret", label: "Webhook Secret", placeholder: "whsec_xxxxxxxx", secret: true }
  ]
};

interface Props {
  connectorKey: string;
  enabled: boolean;
  currentConfig?: Record<string, string>;
}

export function ConnectorConfigPanel({ connectorKey, enabled, currentConfig = {} }: Props) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(currentConfig);
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const fields = connectorFields[connectorKey];
  if (!fields) {
    return (
      <button className="text-sm font-medium text-slate-400" disabled>
        {enabled ? "Configured" : "Not Configurable"}
      </button>
    );
  }

  const handleSave = async () => {
    setSaving(true);
    setResult(null);
    try {
      const res = await fetch(`/api/connectors/${encodeURIComponent(connectorKey)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: true, configJson: values })
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (data.ok) {
        setResult({ ok: true, message: "Saved successfully. Connector is now active." });
        setTimeout(() => { setOpen(false); setResult(null); }, 2000);
      } else {
        setResult({ ok: false, message: data.error ?? "Save failed" });
      }
    } catch {
      setResult({ ok: false, message: "Network error — API may be offline" });
    } finally {
      setSaving(false);
    }
  };

  const handleDisable = async () => {
    setSaving(true);
    try {
      await fetch(`/api/connectors/${encodeURIComponent(connectorKey)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: false, configJson: values })
      });
      setResult({ ok: true, message: "Connector disabled." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="text-sm font-medium flex items-center gap-1"
        style={{ color: "var(--color-teal)" }}
      >
        {enabled ? "Configure" : "Enable"}
        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
      </button>

      {open && (
        <div className="mt-3 p-4 rounded-xl border border-teal-100 bg-teal-50 space-y-3">
          <div className="text-xs font-semibold text-teal-800 uppercase tracking-wider">
            {connectorKey.replace(/_/g, " ").replace(/\b\w/g, l => l.toUpperCase())} — Configuration
          </div>

          {fields.map((field) => (
            <div key={field.key}>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{field.label}</label>
              <div className="relative">
                <input
                  type={field.secret && !showSecret[field.key] ? "password" : "text"}
                  placeholder={field.placeholder}
                  value={values[field.key] ?? ""}
                  onChange={(e) => setValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 pr-9"
                />
                {field.secret && (
                  <button
                    type="button"
                    onClick={() => setShowSecret(prev => ({ ...prev, [field.key]: !prev[field.key] }))}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  >
                    {showSecret[field.key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
          ))}

          {result && (
            <div className={`flex items-center gap-2 p-2.5 rounded-lg text-xs font-medium ${result.ok ? "bg-emerald-50 text-emerald-700 border border-emerald-100" : "bg-red-50 text-red-600 border border-red-100"}`}>
              {result.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <XCircle className="w-4 h-4 shrink-0" />}
              {result.message}
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <button
              onClick={() => void handleSave()}
              disabled={saving}
              className="px-4 py-2 text-sm font-semibold text-white rounded-lg flex items-center gap-1.5 disabled:opacity-50"
              style={{ background: "#0f766e" }}
            >
              {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
              Save & Activate
            </button>
            {enabled && (
              <button
                onClick={() => void handleDisable()}
                disabled={saving}
                className="px-4 py-2 text-sm font-medium text-red-500 rounded-lg border border-red-100 hover:bg-red-50 disabled:opacity-50"
              >
                Disable
              </button>
            )}
            <button
              onClick={() => { setOpen(false); setResult(null); }}
              className="px-4 py-2 text-sm font-medium text-slate-500 rounded-lg hover:bg-slate-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
