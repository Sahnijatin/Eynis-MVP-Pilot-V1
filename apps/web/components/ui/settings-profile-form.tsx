"use client";

import { useState } from "react";
import { useUser, useClerk } from "@clerk/nextjs";
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
  initialTimezone = "", initialAddress = "", initialPhone = "",
}: {
  initialFullName: string;
  email: string;
  initialPropertyName: string;
  canEditProperty: boolean;
  propertyLabel: string;
  initialTimezone?: string;
  initialAddress?: string;
  initialPhone?: string;
}) {
  const toast = useToast();
  // Profile photo is managed by the auth provider (Clerk) — the same image the
  // top-bar avatar shows — so we read it here and open Clerk's editor to change
  // it, rather than maintaining a separate (and inconsistent) avatar store.
  const { user } = useUser();
  const clerk = useClerk();
  const avatarUrl = user?.imageUrl && user.hasImage ? user.imageUrl : null;
  const [fullName, setFullName] = useState(initialFullName);
  const [savedName, setSavedName] = useState(initialFullName); // last persisted name
  const [propertyName, setPropertyName] = useState(initialPropertyName);
  const [timezone, setTimezone] = useState(initialTimezone);
  const [address, setAddress] = useState(initialAddress);
  const [phone, setPhone] = useState(initialPhone);
  const [saving, setSaving] = useState(false);
  // Snapshot of the property fields as last saved, so we only PATCH the tenant
  // when something actually changed. Seeded from server-provided props.
  const [propertySnapshot, setPropertySnapshot] = useState(
    { name: initialPropertyName, timezone: initialTimezone, address: initialAddress, phone: initialPhone }
  );

  async function save() {
    if (!fullName.trim()) { toast.push("Full name cannot be empty", "error"); return; }

    // Only send a tenant update when a property field genuinely changed.
    const propertyChanged = canEditProperty && (
      propertyName.trim() !== propertySnapshot.name ||
      timezone.trim() !== propertySnapshot.timezone ||
      address.trim() !== propertySnapshot.address ||
      phone.trim() !== propertySnapshot.phone
    );
    if (propertyChanged) {
      if (!propertyName.trim()) { toast.push(`${propertyLabel} name cannot be empty`, "error"); return; }
      if (!timezone.trim()) { toast.push("Timezone cannot be empty", "error"); return; }
    }

    const nameChanged = fullName.trim() !== savedName;
    if (!nameChanged && !propertyChanged) { toast.push("No changes to save", "info"); return; }

    setSaving(true);
    try {
      const calls: Promise<Response>[] = [];
      if (nameChanged) {
        calls.push(fetch("/api/me", {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ fullName: fullName.trim() }),
        }));
      }
      if (propertyChanged) {
        calls.push(fetch("/api/tenant/profile", {
          method: "PATCH", headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: propertyName.trim(), timezone: timezone.trim(), address: address.trim(), phone: phone.trim() }),
        }));
      }
      const results = await Promise.all(calls);
      const bodies = await Promise.all(results.map(r => r.json().catch(() => ({ ok: false }))));
      const failed = bodies.find((b: { ok?: boolean }) => !b.ok);
      if (failed) { toast.push((failed as { error?: string }).error ?? "Couldn't save changes", "error"); return; }
      if (nameChanged) setSavedName(fullName.trim());
      if (propertyChanged) setPropertySnapshot({ name: propertyName.trim(), timezone: timezone.trim(), address: address.trim(), phone: phone.trim() });
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
        <h3 className="text-base font-semibold text-fg mb-1">Account Information</h3>
        <p className="text-sm text-fg-muted mb-4">Update your personal details.</p>

        <div className="flex items-center gap-4 mb-5">
          <div className="relative">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover" />
            ) : (
              <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-xl font-bold" style={{ background: BRAND }}>{initials(fullName)}</div>
            )}
            {user && (
              <button
                type="button"
                onClick={() => clerk.openUserProfile()}
                className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full bg-surface shadow border border-line flex items-center justify-center hover:bg-surface-inset"
                aria-label="Change photo"
                title="Change your photo"
              >
                <Camera className="w-3 h-3 text-fg-muted" />
              </button>
            )}
          </div>
          {user && (
            <button type="button" onClick={() => clerk.openUserProfile()} className="text-sm font-medium hover:underline" style={{ color: BRAND }}>
              {avatarUrl ? "Change photo" : "Add a photo"}
            </button>
          )}
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
          <h3 className="text-base font-semibold text-fg">{propertyName || propertyLabel} Details</h3>
          {!canEditProperty && (
            <span className="inline-flex items-center gap-1.5 text-xs text-fg-muted">
              <Lock className="w-3 h-3" /> Admins only
            </span>
          )}
        </div>
        <p className="text-sm text-fg-muted mb-4">{propertyLabel} configuration for all staff and integrations.</p>

        <Field label={`${propertyLabel} Name`}>
          <Input value={propertyName} onChange={e => setPropertyName(e.target.value)} disabled={!canEditProperty} placeholder={`Your ${propertyLabel.toLowerCase()} name`} />
        </Field>
        <Field label="Address">
          <Input value={address} onChange={e => setAddress(e.target.value)} disabled={!canEditProperty} placeholder="Street, city, country" />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={`${propertyLabel} Phone`}>
            <div className="flex items-center gap-2">
              <Phone className="w-4 h-4 text-fg-muted shrink-0" />
              <Input value={phone} onChange={e => setPhone(e.target.value)} disabled={!canEditProperty} placeholder="Contact number" />
            </div>
          </Field>
          <Field label="Timezone">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-fg-muted shrink-0" />
              <Input value={timezone} onChange={e => setTimezone(e.target.value)} disabled={!canEditProperty} placeholder="e.g. Asia/Kolkata" />
            </div>
          </Field>
        </div>
      </div>
    </div>
  );
}
