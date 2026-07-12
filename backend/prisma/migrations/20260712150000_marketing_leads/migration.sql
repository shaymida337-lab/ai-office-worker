-- CreateTable
CREATE TABLE "MarketingLead" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "businessType" TEXT NOT NULL,
    "note" TEXT,
    "planInterest" TEXT,
    "source" TEXT,
    "medium" TEXT,
    "campaign" TEXT,
    "landingPath" TEXT,
    "consent" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketingLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketingLead_createdAt_idx" ON "MarketingLead"("createdAt");

-- CreateIndex
CREATE INDEX "MarketingLead_email_idx" ON "MarketingLead"("email");
