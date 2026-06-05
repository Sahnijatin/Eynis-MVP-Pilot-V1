-- AlterTable
ALTER TABLE "CampaignLead" ADD COLUMN     "contactId" TEXT;

-- AlterTable
ALTER TABLE "Deal" ADD COLUMN     "companyId" TEXT;

-- AlterTable
ALTER TABLE "Guest" ADD COLUMN     "companyId" TEXT,
ADD COLUMN     "customFields" JSONB,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "lastActivityAt" TIMESTAMP(3),
ADD COLUMN     "leadScore" INTEGER,
ADD COLUMN     "leadStatus" TEXT,
ADD COLUMN     "lifecycleStage" TEXT NOT NULL DEFAULT 'lead',
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "source" TEXT,
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT,
    "industry" TEXT,
    "size" TEXT,
    "ownerId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "customFields" JSONB,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Company_tenantId_idx" ON "Company"("tenantId");

-- CreateIndex
CREATE INDEX "CampaignLead_contactId_idx" ON "CampaignLead"("contactId");

-- CreateIndex
CREATE INDEX "Deal_companyId_idx" ON "Deal"("companyId");

-- CreateIndex
CREATE INDEX "Guest_companyId_idx" ON "Guest"("companyId");

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Guest" ADD CONSTRAINT "Guest_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Guest"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Deal" ADD CONSTRAINT "Deal_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;
