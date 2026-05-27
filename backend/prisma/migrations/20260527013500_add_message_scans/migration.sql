CREATE TABLE "MessageScan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "emailMessageId" TEXT,
    "whatsappLogId" TEXT,
    "senderName" TEXT,
    "senderEmail" TEXT,
    "senderPhone" TEXT,
    "subject" TEXT,
    "bodyText" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "contactType" TEXT NOT NULL DEFAULT 'other',
    "intent" TEXT NOT NULL DEFAULT 'other',
    "sentiment" TEXT NOT NULL DEFAULT 'neutral',
    "urgency" TEXT NOT NULL DEFAULT 'normal',
    "summary" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "rawAnalysis" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MessageScan_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MessageScan_organizationId_channel_externalId_key" ON "MessageScan"("organizationId", "channel", "externalId");
CREATE INDEX "MessageScan_organizationId_channel_occurredAt_idx" ON "MessageScan"("organizationId", "channel", "occurredAt");
CREATE INDEX "MessageScan_organizationId_contactType_intent_idx" ON "MessageScan"("organizationId", "contactType", "intent");
CREATE INDEX "MessageScan_organizationId_urgency_occurredAt_idx" ON "MessageScan"("organizationId", "urgency", "occurredAt");
CREATE INDEX "MessageScan_senderEmail_idx" ON "MessageScan"("senderEmail");
CREATE INDEX "MessageScan_senderPhone_idx" ON "MessageScan"("senderPhone");

ALTER TABLE "MessageScan" ADD CONSTRAINT "MessageScan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
