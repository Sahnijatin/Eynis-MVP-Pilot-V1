-- White-label routing identity on the tenant (table is still "Hotel" via @@map).
ALTER TABLE "Hotel" ADD COLUMN "slug" TEXT;
ALTER TABLE "Hotel" ADD COLUMN "customDomain" TEXT;

-- Unique per host/slug. Postgres permits multiple NULLs, so existing rows are fine.
CREATE UNIQUE INDEX "Hotel_slug_key" ON "Hotel"("slug");
CREATE UNIQUE INDEX "Hotel_customDomain_key" ON "Hotel"("customDomain");
