-- White-label tier on the tenant (E-9). Set by Eynis staff via the internal
-- provisioning console; distinct from billing (License.plan).
ALTER TABLE "Hotel" ADD COLUMN "whitelabelTier" TEXT NOT NULL DEFAULT 'standard';

-- Widen TenantBranding with an extended token, typography, and artifact-branding flags.
ALTER TABLE "TenantBranding" ADD COLUMN "sidebarColor" TEXT;
ALTER TABLE "TenantBranding" ADD COLUMN "fontFamily" TEXT;
ALTER TABLE "TenantBranding" ADD COLUMN "brandEmails" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "TenantBranding" ADD COLUMN "brandReports" BOOLEAN NOT NULL DEFAULT true;
