CREATE TABLE IF NOT EXISTS "OutgoingInvoiceDraft" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "source" TEXT NOT NULL DEFAULT 'natalie',
  "customerName" TEXT NOT NULL,
  "customerEmail" TEXT,
  "customerTaxId" TEXT,
  "clientId" TEXT,
  "description" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'ILS',
  "issueDate" TIMESTAMP(3),
  "dueDate" TIMESTAMP(3),
  "proposalJson" JSONB NOT NULL,
  "greenInvoiceDocumentId" TEXT,
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OutgoingInvoiceDraft_pkey" PRIMARY KEY ("id")
);

DO $$ BEGIN
  ALTER TABLE "OutgoingInvoiceDraft"
    ADD CONSTRAINT "OutgoingInvoiceDraft_organizationId_fkey"
    FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "OutgoingInvoiceDraft_organizationId_status_idx"
  ON "OutgoingInvoiceDraft"("organizationId", "status");
