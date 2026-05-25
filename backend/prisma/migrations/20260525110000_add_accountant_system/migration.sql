-- AlterTable
ALTER TABLE "Organization"
  ADD COLUMN "accountantEmail" TEXT,
  ADD COLUMN "accountantName" TEXT,
  ADD COLUMN "businessName" TEXT,
  ADD COLUMN "businessId" TEXT,
  ADD COLUMN "businessAddress" TEXT,
  ADD COLUMN "sendMonthlyReport" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reportDay" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "AccountantReport" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "totalIncome" DOUBLE PRECISION NOT NULL,
    "totalExpenses" DOUBLE PRECISION NOT NULL,
    "profit" DOUBLE PRECISION NOT NULL,
    "vatDue" DOUBLE PRECISION NOT NULL,
    "driveUrl" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountantReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountantReport_organizationId_period_key" ON "AccountantReport"("organizationId", "period");

-- CreateIndex
CREATE INDEX "AccountantReport_organizationId_createdAt_idx" ON "AccountantReport"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "AccountantReport" ADD CONSTRAINT "AccountantReport_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
