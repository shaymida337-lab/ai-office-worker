-- CreateTable
CREATE TABLE "MarketingLeadEvent" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingLeadEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingLeadEvent_leadId_createdAt_idx" ON "MarketingLeadEvent"("leadId", "createdAt");

-- AddForeignKey
ALTER TABLE "MarketingLeadEvent" ADD CONSTRAINT "MarketingLeadEvent_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "MarketingLead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex (סינון לפי סטטוס במסך האדמין)
CREATE INDEX "MarketingLead_status_createdAt_idx" ON "MarketingLead"("status", "createdAt");
