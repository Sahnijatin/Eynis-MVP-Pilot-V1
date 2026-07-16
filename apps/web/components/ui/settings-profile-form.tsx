"use client";

import { useEffect, useState } from "react";
import { Save, Camera, Clock, Phone, Lock } from "lucide-react";
import { Button, Field, Input, useToast } from "../ds";

const BRAND = "var(--color-primary, #0f766e)";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Client-side profile + property editor. "Save Changes" persists the display
// name (PATCH /api/me) and — for admins — the tenant's property details
// (PATCH /api/tenant/profile). Email is the login identity and password is
// managed by the auth provider, so both are shown read-only rather than faked.
export function SettingsProfileForm({
  initialFullName, email, initialPropertyName, canEditProperty, propertyLabel,
}: {
  initialFullName: string;
  email: string;
  initialPropertyName: string;
  canEditProperty: boolean;
  propertyLabel: string;
}) {
  const toast = useToast();
  const [fullName, setFullName] = useState(initialFullName);
  const [propertyName, setPropertyName] = useState(initialPropertyName);
  const [timezone, setTimezone] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);

  // Load the tenant's editable property details (admins only — the endpoint
  // requires manage_settings).
  useEffect(() => {
    if (!canEditProperty) return;
    let cancelled = false;
    fetch("/api/tenant/profile", { cache: "no-store" })
      .then(r => r.json())
      .then((data: { ok?: boolean; profile?: { name?: string; timezone?: string; address?: string | null; phone?: string | null } }) => {
        if (cancelled || !data.ok || !data.profile) return;
        setPropertyName(data.profile.name ?? initialPropertyName);
        setTimezone(data.profile.timezone ?? "");
        setAddress(data.profile.address ?? "");
        setPhone(data.profile.phone ?? "");
      })
      .catch(() => { /* keep prop defaults */ });
    return () => { cancelled = true; };
  }, [canEditProperty, initialPropertyName]);

  async function save() {
    if (!fullName.trim()) { toast.push("Full name cannot be empty", "error"); return; }
    if (canEditProperty && !propertyName.trim()) { toast.push(`${propertyLabel} name cannot be empty`, "error"); return; }
    setSaving(true);
    try {
      const calls: Promise<Response>[] = [];
      if (fullName.trim() !== initialFullName) {
        calls.push(fetch("/api/me", {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ fullName: fullName.trim() }),
        }));
      }
      if (canEditProperty) {
        calls.push(fetch("/api/tenant/profile", {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: propertyName.trim(), timezone: timezone.trim(), address: address.trim(), phone: phone.trim() }),
        }));
      }
      if (calls.length === 0) { toast.push("No changes to save", "info"); return; }
      const results = await Promise.all(calls);
      const bodies = await Promise.all(results.map(r => r.json().catch(() => ({ ok: false }))));
      const failed = bodies.find((b: { ok?: boolean }) => !b.ok);
      if (failed) { toast.push((failed as { error?: string }).error ?? "Couldn't save changes", "error"); return; }
      toast.push("Changes saved", "success");
    } catch {
      toast.push("Couldn't save changes — please try again", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="primary" onClick={save} disabled={saving}>
          <Save className="w-3.5 h-3.5" /> {saving ? "Saving…" : "Save Changes"}
        </Button>
      </div>

      {/* Account Information */}
      <div className="card">
        <h3 className="text-base font-semibold text-slate-800 mb-1">Account Information</h3>
        <p className="text-sm text-slate-500 mb-4">Update your personal details.</p>

        <div className="flex items-center gap-4 mb-5">
          <div className="relative">
            <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold" style={{ background: BRAND }}>{initials(fullName)}</div>
            <span className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-white shadow border border-slate-200 flex items-center justify-center" title="Profile photos are coming soon">
              <Camera className="w-3 h-3 text-slate-400" />
            </span>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Full Name">
            <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Your full name" />
          </Field>
          <Field label="Email Address" hint="Your sign-in identity — managed by your login provider.">
            <Input type="email" value={email} disabled placeholder="you@example.com" />
          </Field>
        </div>
        <Field label="Password" hint="Managed by your login provider.">
          <Input type="password" value="" disabled placeholder="••••••••••" />
        </Field>
      </div>

      {/* Property Details */}
      <div className="card">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-semibold text-slate-800">{propertyName || propertyLabel} Details</h3>
          {!canEditProperty && (
            <span className="inline-flex items-center gap-1.5 text-xs text-slate-500">
              <Lock className="w-3 h-3" /> Admins only
            </span>
          )}
        </div>
        <p className="text-sm text-slate-500 mb-4">{propertyLabel} configuration for all staff and integrations.</p>

        <Field label={`${propertyLabel} Name`}>
          <Input value={propertyName} onChange={e => setPropertyName(e.target.value)} disabled={!canEditProperty} placeholder={`Your ${propertyLabel.toLowerCase()} name`} />
        </Field>
        <Field label="Address">
          <Input value={address} onChange={e => setAddress(e.target.value)} disabled={!canEditProperty} placeholder="Street, city, country" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={`${propertyLabel} Phone`}>
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-slate-500 shrink-0" />
              <Input value={phone} onChange={e => setPhone(e.target.value)} disabled={!canEditProperty} placeholder="Contact number" />
            </div>
          </Field>
          <Field label="Timezone">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-slate-500 shrink-0" />
              <Input value={timezone} onChange={e => setTimezone(e.target.value)} disabled={!canEditProperty} placeholder="e.g. Asia/Kolkata" />
            </div>
          </Field>
        </div>
      </div>
    </div>
  );
}
