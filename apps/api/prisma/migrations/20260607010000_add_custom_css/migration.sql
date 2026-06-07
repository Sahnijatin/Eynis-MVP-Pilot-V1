-- Per-tenant sanitised custom CSS (E-9, white_label tier). Stored already-
-- sanitised by the API; injected client-side only for white_label tenants.
ALTER TABLE "TenantBranding" ADD COLUMN "customCss" TEXT;
