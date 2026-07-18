import { cookies } from "next/headers";
import Link from "next/link";
import { STAFF_COOKIE, verifyStaffCookie, isStaffConsoleConfigured, platformBearer } from "../../../lib/platform-admin";
import { getApiBaseUrl } from "../../../lib/api";
import { StaffLogin } from "../../../components/admin/staff-login";

export const dynamic = "force-dynamic";

// Experiment scoreboard (#163) — internal, Eynis-staff-only view that compares the
// verticals side by side on the five lock-decision metrics, so "lock 1 primary +
// shadow 1" is a data call, not a hunch. Gated by the platform-admin secret (not
// Clerk / tenant RBAC), reading the API's /internal/scoreboard route with the
// platform bearer. Read-only, so the server component fetches it directly.

interface VerticalScore {
  industry: string;
  label: string;
  tenants: number;
  liveTenants: number;
  activationAvgDays: number | null;
  weeklyActiveOperators: number;
  attributedValue: { valueType: string; unit: string; amount: number; label: string };
  paidTenants: number;
  wtpConversionPct: number;
  wonDeals: number;
  salesCycleAvgDays: number | null;
}

function fmtValue(v: VerticalScore["attributedValue"]): string {
  if (v.amount === 0) return "—";
  if (v.unit === "INR") return `₹${v.amount.toLocaleString("en-IN")}`;
  // minutes → compact hours when large.
  if (v.amount >= 120) return `${Math.round((v.amount / 60) * 10) / 10} h`;
  return `${v.amount} min`;
}

function fmtDays(d: number | null): string {
  return d === null ? "—" : `${d} d`;
}

export default async function ScoreboardPage() {
  if (!isStaffConsoleConfigured()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-inset p-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-fg mb-2">Scoreboard not configured</h1>
          <p className="text-sm text-fg-muted">
            Set <code className="px-1 py-0.5 rounded bg-surface-inset">PLATFORM_ADMIN_SECRET</code> (16+ characters) in the
            web server environment to enable the internal scoreboard.
          </p>
        </div>
      </div>
    );
  }

  const cookieStore = await cookies();
  if (!verifyStaffCookie(cookieStore.get(STAFF_COOKIE)?.value)) {
    return <StaffLogin />;
  }

  let verticals: VerticalScore[] = [];
  let generatedAt = "";
  let error: string | null = null;
  try {
    const r = await fetch(`${getApiBaseUrl()}/internal/scoreboard`, {
      headers: { authorization: `Bearer ${platformBearer()}` },
      cache: "no-store"
    });
    const data = (await r.json()) as { ok: boolean; error?: string; verticals?: VerticalScore[]; generatedAt?: string };
    if (!r.ok || !data.ok) {
      error = data.error ?? "Failed to load the scoreboard.";
    } else {
      verticals = data.verticals ?? [];
      generatedAt = data.generatedAt ?? "";
    }
  } catch {
    error = "Could not reach the API.";
  }

  // Highlight the leader on the two metrics a primary-vertical call leans on most:
  // most live tenants and most weekly-active operators (real usage, not signups).
  const maxLive = Math.max(0, ...verticals.map((v) => v.liveTenants));
  const maxWao = Math.max(0, ...verticals.map((v) => v.weeklyActiveOperators));

  return (
    <div className="min-h-screen bg-surface-inset p-6">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-semibold text-fg">Experiment scoreboard</h1>
          <Link href="/admin/provisioning" className="text-sm font-medium text-fg-muted hover:text-fg">
            ← Provisioning
          </Link>
        </div>
        <p className="text-sm text-fg-muted mb-5">
          Cross-tenant, per-vertical comparison of the lock-decision metrics. Use it to lock one primary vertical and
          shadow one.{generatedAt ? ` Generated ${new Date(generatedAt).toLocaleString()}.` : ""}
        </p>

        {error ? (
          <div className="p-3 bg-danger-bg text-danger rounded-lg text-sm">{error}</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-fg-muted border-b border-line">
                  <th className="py-2 pr-3 font-medium">Vertical</th>
                  <th className="py-2 px-3 font-medium text-right">Tenants</th>
                  <th className="py-2 px-3 font-medium text-right">Live</th>
                  <th className="py-2 px-3 font-medium text-right">Activation</th>
                  <th className="py-2 px-3 font-medium text-right">Weekly active operators</th>
                  <th className="py-2 px-3 font-medium text-right">Attributed value</th>
                  <th className="py-2 px-3 font-medium text-right">Paid (WTP)</th>
                  <th className="py-2 pl-3 font-medium text-right">Sales cycle</th>
                </tr>
              </thead>
              <tbody>
                {verticals.map((v) => (
                  <tr key={v.industry} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="font-medium text-fg">{v.label}</div>
                      <div className="text-xs text-fg-subtle">{v.attributedValue.label}</div>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-fg">{v.tenants}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      <span className={v.liveTenants > 0 && v.liveTenants === maxLive ? "font-semibold text-accent-text" : "text-fg"}>
                        {v.liveTenants}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-fg">{fmtDays(v.activationAvgDays)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums">
                      <span className={v.weeklyActiveOperators > 0 && v.weeklyActiveOperators === maxWao ? "font-semibold text-accent-text" : "text-fg"}>
                        {v.weeklyActiveOperators}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-fg">{fmtValue(v.attributedValue)}</td>
                    <td className="py-2.5 px-3 text-right tabular-nums text-fg">
                      {v.paidTenants}/{v.tenants}
                      <span className="text-xs text-fg-subtle"> ({v.wtpConversionPct}%)</span>
                    </td>
                    <td className="py-2.5 pl-3 text-right tabular-nums text-fg">
                      {fmtDays(v.salesCycleAvgDays)}
                      {v.wonDeals > 0 ? <span className="text-xs text-fg-subtle"> · {v.wonDeals} won</span> : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-fg-subtle mt-3">
          Activation = avg days from tenant creation to first live signal · Weekly active operators = distinct staff who
          moved a request or deal in the last 7 days · Attributed value = the vertical&apos;s headline metric · WTP =
          tenants on a paid plan · Sales cycle = avg days to close a won deal.
        </p>
      </div>
    </div>
  );
}
