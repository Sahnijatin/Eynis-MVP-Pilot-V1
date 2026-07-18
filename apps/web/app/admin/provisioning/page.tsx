import { cookies } from "next/headers";
import { STAFF_COOKIE, verifyStaffCookie, isStaffConsoleConfigured, platformBearer } from "../../../lib/platform-admin";
import { getApiBaseUrl } from "../../../lib/api";
import { StaffLogin } from "../../../components/admin/staff-login";
import { ProvisioningConsole, type ConsoleTenant, type IndustryOption } from "../../../components/admin/provisioning-console";

export const dynamic = "force-dynamic";

// Internal Eynis-staff provisioning console (E-8). Gated by the platform-admin
// secret (not Clerk / tenant RBAC). Currently sets a tenant's industry; the same
// surface will carry custom domain (E-10) and white-label tier (E-9).
export default async function ProvisioningPage() {
  if (!isStaffConsoleConfigured()) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-inset p-6">
        <div className="max-w-md text-center">
          <h1 className="text-lg font-semibold text-fg mb-2">Provisioning console not configured</h1>
          <p className="text-sm text-fg-muted">
            Set <code className="px-1 py-0.5 rounded bg-surface-inset">PLATFORM_ADMIN_SECRET</code> (16+ characters) in the
            web server environment to enable the internal provisioning console.
          </p>
        </div>
      </div>
    );
  }

  const cookieStore = await cookies();
  if (!verifyStaffCookie(cookieStore.get(STAFF_COOKIE)?.value)) {
    return <StaffLogin />;
  }

  let tenants: ConsoleTenant[] = [];
  let industries: IndustryOption[] = [];
  let tiers: IndustryOption[] = [];
  let plans: IndustryOption[] = [];
  let error: string | null = null;
  try {
    const r = await fetch(`${getApiBaseUrl()}/internal/tenants`, {
      headers: { authorization: `Bearer ${platformBearer()}` },
      cache: "no-store"
    });
    const data = (await r.json()) as { ok: boolean; error?: string; items?: ConsoleTenant[]; industries?: IndustryOption[]; tiers?: IndustryOption[]; plans?: IndustryOption[] };
    if (!r.ok || !data.ok) {
      error = data.error ?? "Failed to load tenants.";
    } else {
      tenants = data.items ?? [];
      industries = data.industries ?? [];
      tiers = data.tiers ?? [];
      plans = data.plans ?? [];
    }
  } catch {
    error = "Could not reach the API.";
  }

  return <ProvisioningConsole tenants={tenants} industries={industries} tiers={tiers} plans={plans} error={error} />;
}
