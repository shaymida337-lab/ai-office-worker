CREATE TABLE "BankStatement" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "fileName" TEXT NOT NULL,
  "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "status" TEXT NOT NULL DEFAULT 'processing',
  "transactionCount" INTEGER NOT NULL DEFAULT 0,

  CONSTRAINT "BankStatement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankTransaction" (
  "id" TEXT NOT NULL,
  "bankStatementId" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "description" TEXT,
  "direction" TEXT NOT NULL,
  "rawData" TEXT,
  "matchStatus" TEXT NOT NULL DEFAULT 'unmatched',
  "matchedInvoiceId" TEXT,
  "matchedSupplierPaymentId" TEXT,
  "matchConfidence" DOUBLE PRECISION,

  CONSTRAINT "BankTransaction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BankStatement_organizationId_idx" ON "BankStatement"("organizationId");
CREATE INDEX "BankTransaction_organizationId_idx" ON "BankTransaction"("organizationId");
CREATE INDEX "BankTransaction_bankStatementId_idx" ON "BankTransaction"("bankStatementId");

ALTER TABLE "BankStatement"
ADD CONSTRAINT "BankStatement_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BankTransaction"
ADD CONSTRAINT "BankTransaction_bankStatementId_fkey"
FOREIGN KEY ("bankStatementId") REFERENCES "BankStatement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "BankTransaction"
ADD CONSTRAINT "BankTransaction_organizationId_fkey"
FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
