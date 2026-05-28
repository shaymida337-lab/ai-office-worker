CREATE TABLE "GmailScanItem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "emailMessageId" TEXT,
    "gmailMessageId" TEXT NOT NULL,
    "gmailMessageLink" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "senderEmail" TEXT,
    "subject" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "amount" DOUBLE PRECISION,
    "supplierName" TEXT NOT NULL,
    "documentType" TEXT NOT NULL,
    "attachmentFilename" TEXT,
    "driveFileLink" TEXT,
    "confidenceScore" TEXT NOT NULL,
    "reviewStatus" TEXT NOT NULL DEFAULT 'needs_review',
    "duplicateKey" TEXT NOT NULL,
    "decisionReason" TEXT NOT NULL,
    "rawAnalysis" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GmailScanItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GmailScanItem_organizationId_duplicateKey_key" ON "GmailScanItem"("organizationId", "duplicateKey");
CREATE INDEX "GmailScanItem_organizationId_reviewStatus_occurredAt_idx" ON "GmailScanItem"("organizationId", "reviewStatus", "occurredAt");
CREATE INDEX "GmailScanItem_organizationId_documentType_occurredAt_idx" ON "GmailScanItem"("organizationId", "documentType", "occurredAt");
CREATE INDEX "GmailScanItem_gmailMessageId_idx" ON "GmailScanItem"("gmailMessageId");
CREATE INDEX "GmailScanItem_senderEmail_idx" ON "GmailScanItem"("senderEmail");

ALTER TABLE "GmailScanItem" ADD CONSTRAINT "GmailScanItem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
