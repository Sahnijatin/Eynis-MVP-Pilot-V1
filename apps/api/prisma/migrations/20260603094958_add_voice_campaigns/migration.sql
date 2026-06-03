-- CreateTable
CREATE TABLE "VoiceCampaign" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "scriptTemplate" TEXT NOT NULL,
    "outcomeTypes" TEXT NOT NULL DEFAULT '[]',
    "followUpRules" TEXT NOT NULL DEFAULT '{}',
    "calendlyLink" TEXT,
    "voiceA" TEXT NOT NULL,
    "voiceB" TEXT NOT NULL,
    "personaA" TEXT NOT NULL,
    "personaB" TEXT NOT NULL,
    "vapiAssistantIdA" TEXT,
    "vapiAssistantIdB" TEXT,
    "maxRetries" INTEGER NOT NULL DEFAULT 2,
    "retryDelayHours" INTEGER NOT NULL DEFAULT 24,
    "maxConcurrent" INTEGER NOT NULL DEFAULT 5,
    "spendCapCalls" INTEGER,
    "defaultCountryCode" TEXT NOT NULL DEFAULT '+91',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VoiceCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignLead" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "company" TEXT,
    "jobTitle" TEXT,
    "rawData" TEXT NOT NULL DEFAULT '{}',
    "abVariant" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "callAttempts" INTEGER NOT NULL DEFAULT 0,
    "nextCallAt" TIMESTAMP(3),
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "consentSource" TEXT,
    "consentAt" TIMESTAMP(3),
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignLead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CallRecord" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "vapiCallId" TEXT,
    "abVariant" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'initiated',
    "outcome" TEXT,
    "durationSeconds" INTEGER,
    "transcript" TEXT,
    "aiSummary" TEXT,
    "sentiment" TEXT,
    "keyPoints" TEXT NOT NULL DEFAULT '[]',
    "whatsappSent" BOOLEAN NOT NULL DEFAULT false,
    "emailSent" BOOLEAN NOT NULL DEFAULT false,
    "meetingBooked" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CallRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SentimentEvent" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "callRecordId" TEXT,
    "conversationId" TEXT,
    "speaker" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "sentiment" TEXT NOT NULL,
    "score" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentimentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappConversation" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'open',
    "lastMessageAt" TIMESTAMP(3),
    "threadSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappConversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappMessage" (
    "id" TEXT NOT NULL,
    "hotelId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "sentiment" TEXT,
    "score" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WhatsappMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VoiceCampaign_hotelId_status_idx" ON "VoiceCampaign"("hotelId", "status");

-- CreateIndex
CREATE INDEX "CampaignLead_campaignId_status_idx" ON "CampaignLead"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignLead_hotelId_phone_idx" ON "CampaignLead"("hotelId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignLead_campaignId_phone_key" ON "CampaignLead"("campaignId", "phone");

-- CreateIndex
CREATE UNIQUE INDEX "CallRecord_vapiCallId_key" ON "CallRecord"("vapiCallId");

-- CreateIndex
CREATE INDEX "CallRecord_campaignId_status_idx" ON "CallRecord"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CallRecord_hotelId_createdAt_idx" ON "CallRecord"("hotelId", "createdAt");

-- CreateIndex
CREATE INDEX "SentimentEvent_callRecordId_createdAt_idx" ON "SentimentEvent"("callRecordId", "createdAt");

-- CreateIndex
CREATE INDEX "SentimentEvent_conversationId_createdAt_idx" ON "SentimentEvent"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "WhatsappConversation_hotelId_state_idx" ON "WhatsappConversation"("hotelId", "state");

-- CreateIndex
CREATE INDEX "WhatsappConversation_leadId_idx" ON "WhatsappConversation"("leadId");

-- CreateIndex
CREATE INDEX "WhatsappMessage_conversationId_createdAt_idx" ON "WhatsappMessage"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "VoiceCampaign" ADD CONSTRAINT "VoiceCampaign_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignLead" ADD CONSTRAINT "CampaignLead_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "VoiceCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "VoiceCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CallRecord" ADD CONSTRAINT "CallRecord_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CampaignLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentimentEvent" ADD CONSTRAINT "SentimentEvent_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentimentEvent" ADD CONSTRAINT "SentimentEvent_callRecordId_fkey" FOREIGN KEY ("callRecordId") REFERENCES "CallRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SentimentEvent" ADD CONSTRAINT "SentimentEvent_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsappConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappConversation" ADD CONSTRAINT "WhatsappConversation_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappConversation" ADD CONSTRAINT "WhatsappConversation_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "VoiceCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappConversation" ADD CONSTRAINT "WhatsappConversation_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "CampaignLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_hotelId_fkey" FOREIGN KEY ("hotelId") REFERENCES "Hotel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappMessage" ADD CONSTRAINT "WhatsappMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "WhatsappConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
