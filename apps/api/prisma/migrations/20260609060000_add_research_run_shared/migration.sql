-- Per-run tenant-wide visibility toggle (mirrors Report.shared). Existing runs
-- default to private (creator + explicit grants + admins only).
ALTER TABLE "ResearchRun" ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT false;
