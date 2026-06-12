-- CreateTable
CREATE TABLE "Place" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'other',
    "description" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "address" TEXT,
    "rating" DOUBLE PRECISION,
    "priceLevel" INTEGER,
    "imageUrl" TEXT,
    "website" TEXT,
    "phone" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "goldenTier" TEXT,
    "goldenUntil" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Place_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Place_tenantId_idx" ON "Place"("tenantId");

-- CreateIndex
CREATE INDEX "Place_tenantId_category_idx" ON "Place"("tenantId", "category");

-- CreateIndex
CREATE INDEX "Place_tenantId_goldenUntil_idx" ON "Place"("tenantId", "goldenUntil");

-- AddForeignKey
ALTER TABLE "Place" ADD CONSTRAINT "Place_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Place" ADD CONSTRAINT "Place_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
