"use client";

import { CreditCard, Zap, Building2, CheckCircle } from "lucide-react";
import type { TeamLicenseResponse } from "../../lib/data";
import { getIndustryConfig } from "../../lib/industry-config";

const INDUSTRY_PLAN_FEATURES: Record<string, { starter: string[]; growth: string[] }> = {
  hospitality: {
    starter: ["Up to 5 seats", "5 system roles", "Service request management", "AI classification", "WhatsApp integration", "Basic reports"],
    growth:  ["Up to 25 seats", "Custom roles", "Night Audit AI", "Revenue intelligence", "Sentiment analytics", "Priority support"],
  },
  manufacturing: {
    starter: ["Up to 5 seats", "5 system roles", "Order management", "Basic inventory tracking", "Client database", "Basic reports"],
    growth:  ["Up to 25 seats", "Custom roles", "AI Brain", "Advanced automations", "Yield & margin analytics", "Priority support"],
  },
  fnb: {
    starter: ["Up to 5 seats", "5 system roles", "Live order tracking", "Basic menu management", "Customer database", "Basic reports"],
    growth:  ["Up to 25 seats", "Custom roles", "AI Brain", "Advanced automations", "Revenue & menu analytics", "Priority support"],
  },
  travel: {
    starter: ["Up to 5 seats", "5 system roles", "Booking pipeline", "Client database", "AI classification", "Basic analytics"],
    growth:  ["Up to 25 seats", "Custom roles", "AI Brain", "Advanced automations", "Revenue analytics", "Priority support"],
  },
  healthcare: {
    starter: ["Up to 5 seats", "5 system roles", "Appointment scheduling", "Patient records", "Follow-up reminders", "Basic analytics"],
    growth:  ["Up to 25 seats", "Custom roles", "AI Brain", "Advanced automations", "Patient analytics", "Priority support"],
  },
};

const ENTERPRISE_FEATURES = [
  "Unlimited seats", "Dedicated onboarding", "SLA guarantee",
  "Custom integrations", "White-labeling", "24/7 support",
];

function getPlans(industry: string) {
  const features = INDUSTRY_PLAN_FEATURES[industry] ?? INDUSTRY_PLAN_FEATURES.hospitality;
  return [
    { key: "starter",    name: "Starter",    price: "₹2,999",  period: "/mo", color: "border-line", badge: null,      features: features.starter },
    { key: "growth",     name: "Growth",     price: "₹7,999",  period: "/mo", color: "border-accent-border",  badge: "Popular", features: features.growth  },
    { key: "enterprise", name: "Enterprise", price: "Custom",   period: "",    color: "border-slate-800", badge: null,      features: ENTERPRISE_FEATURES },
  ];
}

interface Props {
  license: TeamLicenseResponse["license"] | null;
  industry?: string;
  // The tenant's own support address (white-label, F-21). Never hardcode an
  // eynis.com identity into customer-facing copy.
  supportEmail?: string | null;
}

export default function BillingClient({ license, industry = "hospitality", supportEmail }: Props) {
  const billingContact = supportEmail?.trim() || "your account administrator";
  const PLANS = getPlans(industry);
  const config = getIndustryConfig(industry);
  const accentColor = config.accentColor;
  const SETTINGS_TABS = [
    { label: `Profile & ${config.terminology.property}`, href: "/settings" },
    { label: config.terminology.team, href: "/settings/team" },
    { label: "Roles", href: "/settings/roles" },
    { label: "Billing", href: "/settings/billing" },
  ];
  const plan = license?.plan ?? "starter";
  const usedSeats = license?.usedSeats ?? 0;
  const maxSeats = license?.maxSeats ?? 5;
  const renewsAt = license?.renewsAt ? new Date(license.renewsAt) : null;
  const seatPct = Math.min(100, Math.round((usedSeats / maxSeats) * 100));

  function formatDate(d: Date) {
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage your {config.terminology.team.toLowerCase()}, roles, and billing.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-line mb-6">
        {SETTINGS_TABS.map((tab) => {
          const active = tab.href === "/settings/billing";
          return (
            <a
              key={tab.href}
              href={tab.href}
              className="px-5 py-3 text-sm font-medium border-b-2 transition-colors"
              style={active
                ? { borderColor: accentColor, color: accentColor }
                : { borderColor: "transparent", color: "#64748b" }
              }
            >
              {tab.label}
            </a>
          );
        })}
      </div>

      <div className="space-y-6">
        {/* Current plan summary */}
        <div className="card">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-accent-bg flex items-center justify-center">
                <CreditCard className="w-5 h-5 text-accent-text" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-fg capitalize">{plan} Plan</h3>
                  <span className="text-[10px] px-1.5 py-0.5 bg-accent-bg text-accent-text rounded font-medium uppercase tracking-wide">
                    Active
                  </span>
                </div>
                <p className="text-xs text-fg-muted mt-0.5">
                  {renewsAt ? `Renews ${formatDate(renewsAt)}` : "No renewal date set"}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div className="bg-surface-inset rounded-lg p-3">
              <div className="text-xs text-fg-muted mb-1">Seat Usage</div>
              <div className="text-xl font-bold text-fg">
                {usedSeats} <span className="text-sm font-normal text-fg-muted">/ {maxSeats}</span>
              </div>
              <div className="mt-2 h-1.5 bg-surface-inset rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full ${seatPct >= 90 ? "bg-danger-solid" : seatPct >= 70 ? "bg-warn-solid" : "bg-accent"}`}
                  style={{ width: `${seatPct}%` }}
                />
              </div>
              <div className="text-xs text-fg-muted mt-1">{maxSeats - usedSeats} seats remaining</div>
            </div>
            <div className="bg-surface-inset rounded-lg p-3">
              <div className="text-xs text-fg-muted mb-1">Next Renewal</div>
              <div className="text-sm font-bold text-fg">
                {renewsAt ? formatDate(renewsAt) : "—"}
              </div>
              <div className="text-xs text-fg-muted mt-1 capitalize">Auto-renews via Razorpay</div>
            </div>
          </div>
        </div>

        {/* Plan cards */}
        <div>
          <h3 className="text-sm font-semibold text-fg mb-3">Available Plans</h3>
          <div className="grid grid-cols-3 gap-4">
            {PLANS.map((p) => {
              const isCurrent = p.key === plan;
              return (
                <div
                  key={p.key}
                  className={`rounded-xl border-2 p-5 relative ${p.color} ${isCurrent ? "bg-accent-bg/40" : "bg-surface"}`}
                >
                  {p.badge && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 text-[10px] px-2 py-0.5 bg-accent text-accent-contrast rounded-full font-semibold uppercase tracking-wide">
                      {p.badge}
                    </span>
                  )}
                  {isCurrent && (
                    <span className="absolute -top-2.5 right-4 text-[10px] px-2 py-0.5 bg-accent text-accent-contrast rounded-full font-semibold uppercase tracking-wide">
                      Current
                    </span>
                  )}

                  <div className="flex items-center gap-2 mb-1">
                    {p.key === "starter" && <Zap className="w-4 h-4 text-fg-muted" />}
                    {p.key === "growth" && <Zap className="w-4 h-4 text-accent-text" />}
                    {p.key === "enterprise" && <Building2 className="w-4 h-4 text-fg" />}
                    <span className="text-sm font-bold text-fg">{p.name}</span>
                  </div>

                  <div className="mb-4">
                    <span className="text-2xl font-bold text-fg">{p.price}</span>
                    <span className="text-xs text-fg-muted">{p.period}</span>
                  </div>

                  <ul className="space-y-1.5 mb-5">
                    {p.features.map((f) => (
                      <li key={f} className="flex items-start gap-1.5 text-xs text-fg-muted">
                        <CheckCircle className="w-3.5 h-3.5 text-accent-text shrink-0 mt-0.5" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  {isCurrent ? (
                    <button disabled className="w-full py-2 text-xs font-medium rounded-lg bg-surface-inset text-fg-muted cursor-not-allowed">
                      Current Plan
                    </button>
                  ) : p.key === "enterprise" ? (
                    <button className="w-full py-2 text-xs font-medium rounded-lg border border-slate-800 text-fg hover:bg-surface-inset transition-colors">
                      Contact Sales
                    </button>
                  ) : (
                    <button
                      onClick={() => {
                        alert(`Online upgrades are coming soon. Contact ${billingContact} to upgrade.`);
                      }}
                      className="w-full py-2 text-xs font-medium rounded-lg text-white transition-colors"
                      style={{ background: "var(--color-primary, #0f766e)" }}
                    >
                      Upgrade to {p.name}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Payment section */}
        <div className="card bg-surface-inset">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 bg-info-solid rounded-lg flex items-center justify-center">
              <CreditCard className="w-4 h-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-fg">Razorpay Billing</h3>
              <p className="text-xs text-fg-muted">Subscriptions managed via Razorpay</p>
            </div>
          </div>
          <p className="text-xs text-fg-muted leading-relaxed">
            All plan changes are processed through Razorpay. Your subscription will be billed monthly
            in INR. To modify your subscription, upgrade/downgrade above or contact{" "}
            <span className="text-accent-text font-medium">{billingContact}</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
